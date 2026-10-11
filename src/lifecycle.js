// Own the listeners and timers installed by one application/controller instance.
export function createLifecycle() {
    const controller = new AbortController();
    const timeouts = new Set();
    const intervals = new Set();

    function listen(target, type, handler, options = {}) {
        if (!target) return;
        const settings = typeof options === 'boolean' ? { capture: options } : options;
        target.addEventListener(type, handler, { ...settings, signal: controller.signal });
    }

    function timeout(callback, delay) {
        if (controller.signal.aborted) return null;
        const handle = setTimeout(() => {
            timeouts.delete(handle);
            callback();
        }, delay);
        timeouts.add(handle);
        return handle;
    }

    function cancelTimeout(handle) {
        clearTimeout(handle);
        timeouts.delete(handle);
    }

    function interval(callback, delay) {
        if (controller.signal.aborted) return null;
        const handle = setInterval(callback, delay);
        intervals.add(handle);
        return handle;
    }

    function cancelInterval(handle) {
        clearInterval(handle);
        intervals.delete(handle);
    }

    function dispose() {
        controller.abort();
        for (const handle of timeouts) clearTimeout(handle);
        for (const handle of intervals) clearInterval(handle);
        timeouts.clear();
        intervals.clear();
    }

    return { listen, timeout, cancelTimeout, interval, cancelInterval, dispose, signal: controller.signal };
}
