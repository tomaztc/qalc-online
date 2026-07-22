/*
    Qalculate! web (WebAssembly) driver.

    Wraps the real qalc CLI (qalc.cc, compiled with -DQALC_WEB) so it can be
    driven from JavaScript one input line at a time, exactly as if a user were
    typing at the interactive prompt. The REPL runs on its own Emscripten fiber;
    qalc_web_read_line() yields back to the JS-facing driver whenever qalc wants
    the next line of input, and resumes with the line supplied by qalc_web_eval().

    This preserves 100% of qalc's command, configuration, formatting, history and
    "ans" behaviour -- the browser is just a terminal. No pthreads are used (see
    the fiber-based Thread reimplementation in util.cc), so the resulting module
    is a plain static wasm file that needs no SharedArrayBuffer / COOP-COEP setup.
*/

#include <emscripten/fiber.h>
#include <emscripten/emscripten.h>
#include <libqalculate/util.h>

#include <string>
#include <cstdio>
#include <cstdlib>

// Defined in qalc.cc (renamed main under -DQALC_WEB).
extern int qalc_main(int argc, char *argv[]);
// Persist current settings to qalc.cfg (qalc.cc, -DQALC_WEB). The CLI only saves
// on exit; the web app never exits, so we call this after every evaluation.
extern void qalc_web_persist();
// Side-effect-free evaluation of an expression for the live "as you type"
// preview: honours current config but does NOT touch ans/history/messages.
extern const char *qalc_web_preview_expression(const char *expr, int timeout_ms);

// ---------------------------------------------------------------------------
// Fiber plumbing
// ---------------------------------------------------------------------------

static emscripten_fiber_t g_driver_fiber;   // the JS-facing context
static emscripten_fiber_t g_qalc_fiber;     // runs qalc_main()
static char g_driver_astack[256 * 1024];
static char *g_qalc_cstack = NULL;          // qalc REPL C stack (deep recursion)
static char *g_qalc_astack = NULL;
#define QALC_CSTACK (32 * 1024 * 1024)
#define QALC_ASTACK (512 * 1024)

static std::string g_pending_line;   // input queued by the driver for qalc
static bool g_qalc_done = false;     // qalc_main returned
static bool g_started = false;

// Yield from the qalc REPL fiber back to the driver fiber.
static void yield_to_driver() {
	qalc_fiber_swap_to(&g_driver_fiber);
}

// Called by qalc.cc's REPL when it wants a line of input. Runs on the qalc
// fiber. Yields to the driver and, when resumed, returns the queued line.
extern "C" const char *qalc_web_read_line() {
	yield_to_driver();            // -> returns to qalc_web_eval / init
	return g_pending_line.c_str();
}

// Entry point of the qalc fiber.
static void qalc_fiber_entry(void *) {
	char arg0[] = "qalc";
	// -u8: force UTF-8 I/O; the JS side is UTF-8 throughout.
	char arg1[] = "-u8";
	char *argv[] = { arg0, arg1, NULL };
	qalc_main(2, argv);
	g_qalc_done = true;
	// REPL ended; hand control back to the driver for good.
	yield_to_driver();
}

// ---------------------------------------------------------------------------
// Public API (called from JS)
// ---------------------------------------------------------------------------

extern "C" {

// Point qalc's getLocalDir()/getLocalStateDir() at a directory the JS side has
// mounted (e.g. an IDBFS-backed path) by setting the QALCULATE_USER_DIR
// environment variable inside the wasm runtime. Must be called before
// qalc_web_start(). Module.ENV is not reliably exported, so we set it here.
EMSCRIPTEN_KEEPALIVE
void qalc_web_set_userdir(const char *dir) {
	if(dir && *dir) setenv("QALCULATE_USER_DIR", dir, 1);
}

// Initialise the calculator and run through startup until it first blocks
// waiting for input. Must be called once, after the persistent config dir has
// been mounted. Any startup banner/messages are emitted to stdout.
EMSCRIPTEN_KEEPALIVE
void qalc_web_start() {
	if(g_started) return;
	g_started = true;

	emscripten_fiber_init_from_current_context(&g_driver_fiber, g_driver_astack, sizeof(g_driver_astack));
	qalc_fiber_set_main(&g_driver_fiber);

	g_qalc_cstack = (char *) malloc(QALC_CSTACK);
	g_qalc_astack = (char *) malloc(QALC_ASTACK);
	emscripten_fiber_init(&g_qalc_fiber, &qalc_fiber_entry, NULL,
		g_qalc_cstack, QALC_CSTACK, g_qalc_astack, QALC_ASTACK);

	// Run qalc through initialisation until it blocks on the first read_line().
	qalc_fiber_swap_to(&g_qalc_fiber);
}

// Feed one line of input to the REPL and run it to completion, exactly as if the
// user typed it at the interactive prompt. This is the "commit" path: it updates
// ans, history and any configuration, and output is produced synchronously via
// stdout (captured by Module.print on the JS side). Settings are persisted to the
// virtual FS afterwards so the JS side can flush them to IndexedDB.
EMSCRIPTEN_KEEPALIVE
void qalc_web_eval(const char *line) {
	if(!g_started || g_qalc_done) return;
	g_pending_line = line ? line : "";
	// Re-capture the current JS call stack as the driver fiber before every eval.
	// qalc_web_eval() may be called from different JS contexts (event handlers,
	// promises, etc.) each with their own call stack. The qalc fiber must yield
	// back to the correct one, so we re-initialise g_driver_fiber here rather
	// than relying on the context captured once at qalc_web_start() time.
	emscripten_fiber_init_from_current_context(&g_driver_fiber, g_driver_astack, sizeof(g_driver_astack));
	qalc_fiber_set_main(&g_driver_fiber);
	qalc_fiber_swap_to(&g_qalc_fiber);
	qalc_web_persist();
	fflush(stdout);
}

// Side-effect-free live preview of an expression using the current settings.
// The returned pointer is owned by qalc's reusable preview buffer. Emscripten
// copies it into a JS string before returning, avoiding one leaked allocation
// per preview. Runs directly on the driver fiber -- no worker is needed.
EMSCRIPTEN_KEEPALIVE
const char *qalc_web_preview(const char *line) {
	if(!g_started || g_qalc_done || !line) return "";
	const char *out = qalc_web_preview_expression(line, 500);
	return out ? out : "";
}

} // extern "C"
