import {RecordedRead, recordedReadsArraysAreEqual, RecordedValueRead, WatchedGraph} from "./watchedGraph";
import {arraysAreEqualsByPredicateFn, PromiseState, throwError} from "./Util";
import {useLayoutEffect, useState, createElement, Fragment, ReactNode, useEffect, useContext} from "react";
import {ErrorBoundaryContext, useErrorBoundary} from "react-error-boundary";
import {ProxiedGraph} from "./proxiedGraph";

export {debug_numberOfPropertyChangeListeners} from "./watchedGraph"; // TODO: Remove before release

let watchedGraph: WatchedGraph | undefined

type WatchedComponentOptions = {
    /**
     * A fallback react tree to show when some `load(...)` statement in <strong>this</strong> component is loading.
     * Use this if you have issues with screen flickering with <code><Suspense></code>.
     */
    fallback?: ReactNode,

    /**
     * Everything that's **taken** from props, {@link useWatchedState} or {@link watched} will be returned, wrapped in a proxy that watches for modifications.
     * So far, so good, this can handle all stuff that's happening inside your component, but the outside world does not have these proxies. For example, the parent component, that passed in an object (i.e. the model) into this component via props.
     * Therefore this component can also **patch** these objects to make them watchable. I.e. it defines setters for properties or replaces the push method for an array instance.
     *
     *
     * <p>Default: true</p>
     */
    watchExternalModifications?: boolean
}

class RecordedLoadCall {
    /**
     * From the beginning or previous load call up to this one
     */
    recordedReadsBefore!: RecordedRead[];
    recordedReadsInsideLoaderFn!: RecordedRead[];

    result!: PromiseState<unknown>;
}

/**
 * Fields that persist across re-render
 */
class WatchedComponentPersistent {
    loadCalls: RecordedLoadCall[] = [];
    _doReRender!: () => void

    /**
     * See {@link https://github.com/bvaughn/react-error-boundary?tab=readme-ov-file#dismiss-the-nearest-error-boundary}
     * From optional package.
     */
    dismissErrorBoundary?: () => void;

    /**
     * Set, when the next render should be a passive render / no load action should be done
     */
    passiveRenderForStateIndicator?: RenderRun


    doReRender() {
        // Call listeners:
        this.onBeforeReRenderListeners.forEach(fn => fn());
        this.onBeforeReRenderListeners = [];

        this._doReRender()
    }

    /**
     * When a load finished or finished with error, so the component needs to be rerendered
     */
    handleLoadedValueChanged() {
        this.dismissErrorBoundary?.();
        this.doReRender();
    }

    /**
     * RenderRun, when component is currently rendering or beeing displayed (also for passive runs, if the passive run had that outcome)
     * undefined, when component was unmounted (and nothing was thrown / not loading)
     * Promise, when something is loading and component is in suspense (also for passive runs, if the passive run had that outcome)
     * Error when error was thrown during last render (also for passive runs, if the passive run had that outcome)
     * unknown: Something else was thrown during last render (also for passive runs, if the passive run had that outcome)
     */
    state!: RenderRun | undefined | Promise<unknown> | Error | unknown;
    hadASuccessfullMount = false;

    onBeforeReRenderListeners: (()=>void)[] = [];
}

/**
 * Lifecycle: Starts when rendering and ends when unmounting or re-rendering the WatchedComponent.
 * - References to this can still exist when WatchedComponentPersistent is in a resumeable error state (is this a good idea? )
 */
class RenderRun {

    //watchedGraph= new WatchedGraph();
    get watchedGraph() {
        // Use a global shared instance. Because there's no exclusive state inside the graph/handlers. And state.someObj = state.someObj does not cause us multiple nesting layers of proxies. Still this may not the final choice. When changing this mind also the `this.proxyHandler === other.proxyHandler` in RecordedPropertyRead#equals
        return watchedGraph || (watchedGraph = new WatchedGraph()); // Lazy initialize global variable
    }

    recordedReads: RecordedRead[] = [];

    persistent: WatchedComponentPersistent;

    /**
     * Increased, when we see a load(...) call
     */
    loadCallIndex = 0;

    /**
     * Cache of persistent.loadCalls.some(l => l.result.state === "pending")
     */
    somePending?: Promise<unknown>;
    somePendingAreCritical = false;

    /**
     * someLoading() or someError() was called
     */
    passiveRenderForStateIndicatorRequested=false;

    cleanedUp = false;

    startPropChangeListeningFns: (()=>void)[] = [];
    startListeningForPropertyChanges() {
        this.startPropChangeListeningFns.forEach(c => c()); // Clean the listeners
    }

    cleanUpPropChangeListenerFns: (()=>void)[] = [];
    stopListeningForPropertyChanges() {
        this.cleanUpPropChangeListenerFns.forEach(c => c()); // Clean the listeners
        this.cleanedUp = true;
    }

    onUnmount() {
        if(this.persistent.state instanceof Error && this.persistent.dismissErrorBoundary !== undefined) { // Error is displayed ?
            // Still listen for property changes to be able to recover from errors

            this.persistent.onBeforeReRenderListeners.push(() => {this.stopListeningForPropertyChanges()}); //Instead clean up listeners on next render
        }
        else {
            this.stopListeningForPropertyChanges();
        }

        if(this.persistent.state === this) {
            this.persistent.state = undefined;
        }
    }

    handleWatchedPropertyChange() {
        if(this.cleanedUp) {
            throw new Error("Illegal state: This render run has already be cleaned up. There must not be any more listeners left that call here.");
        }
        this.persistent.dismissErrorBoundary?.();
        this.persistent.doReRender();
    }

    constructor(persistent: WatchedComponentPersistent) {
        this.persistent = persistent
        persistent.state = this;
    }
}
let currentRenderRun: RenderRun| undefined;

export function WatchedComponent<PROPS extends object>(componentFn:(props: PROPS) => any, options: WatchedComponentOptions = {}) {
    return (props: PROPS) => {
        const [renderCounter, setRenderCounter] = useState(0);
        const [persistent] = useState(new WatchedComponentPersistent());
        persistent._doReRender = () => setRenderCounter(renderCounter+1);
        useEffect(() => {
            persistent.hadASuccessfullMount = true;
        });

        // Register dismissErrorBoundary function:
        if(typeof useErrorBoundary === "function") { // Optional package was loaded?
            if(useContext(ErrorBoundaryContext)) { // Inside an error boundary?
                persistent.dismissErrorBoundary = useErrorBoundary().resetBoundary;
            }
        }

        // Create RenderRun:
        currentRenderRun === undefined || throwError("Illegal state: already in currentRenderRun");
        const renderRun = currentRenderRun = new RenderRun(persistent);
        const isPassiveRender = persistent.passiveRenderForStateIndicator !== undefined;

        useEffect(() => {
            renderRun.startListeningForPropertyChanges();
            return () => renderRun.onUnmount();
        });


        try {
            const watchedProps = createProxyForProps(renderRun.watchedGraph, props);

            // Install read listener:
            let readListener = (read: RecordedRead)  => {
                if(!isPassiveRender) {
                    // Re-render on a change of the read value:
                    const changeListener = (newValue: unknown) => {
                        if (currentRenderRun) {
                            throw new Error("You must not modify a watched object during the render run.");
                        }
                        renderRun.handleWatchedPropertyChange();
                    }
                    renderRun.startPropChangeListeningFns.push(() => read.onChange(changeListener));
                    renderRun.cleanUpPropChangeListenerFns.push(() => read.offChange(changeListener));
                }

                renderRun.recordedReads.push(read);
            };
            renderRun.watchedGraph.onAfterRead(readListener)

            try {
                return componentFn(watchedProps); // Run the user's component function
            }
            catch (e) {
                persistent.state = e;
                if(e instanceof Promise) {
                    if(!persistent.hadASuccessfullMount) {
                        // Handle the suspense ourself. Cause the react Suspense does not restore the state by useState :(
                        e.finally(() => {persistent.handleLoadedValueChanged()})
                        return createElement(Fragment, null); // Return an empty element (might cause a short screen flicker) an render again.
                    }

                    if(options.fallback) {
                        e.finally(() => {persistent.handleLoadedValueChanged()})
                        return options.fallback;
                    }

                    // React's <Suspense> seems to keep this component mounted (hidden), so here's no need for an artificial renderRun.startListeningForPropertyChanges();
                }

                if(renderRun.passiveRenderForStateIndicatorRequested) {
                    return createElement(Fragment, null); // Don't go to suspense **now**. The passive render might have a different outcome. (rerender will be done, see "finally")
                }

                throw e;
            }
            finally {
                renderRun.watchedGraph.offAfterRead(readListener);
            }
        }
        finally {
            renderRun.recordedReads = []; // renderRun is still referenced in closures, but this field is not needed, so let's not hold a big grown array here and may be prevent memory leaks
            currentRenderRun = undefined;

            //Safety check:
            (isPassiveRender && renderRun.passiveRenderForStateIndicatorRequested) && throwError("Illegal state");

            if(isPassiveRender) {
                persistent.passiveRenderForStateIndicator = undefined; // Don't render passive again next time.
            }
            else {
                if(renderRun.passiveRenderForStateIndicatorRequested) {
                    persistent.passiveRenderForStateIndicator = renderRun; // Render passive next time
                    setTimeout(() => {
                        persistent.doReRender(); // Hope it won't be faulty to request re-render through setState from the render code.
                    })
                }
            }
        }
    }
}

type WatchedOptions = {
    /**
     * TODO: Implement
     * Called, when a deep property was changed through the proxy.
     */
    onChange: () => void

    /**
     * TODO: Implement
     * Called on a change to one of those properties, that were read-recorded in the component function (through the proxy of course).
     * Reacts also on external changes / not done through the proxy.
     */
    onRecorededChange: () => void
}

function watched<T extends object>(obj: T, options?: WatchedOptions): T {
    currentRenderRun || throwError("watched is not used from inside a WatchedComponent");
    return currentRenderRun!.watchedGraph.getProxyFor(obj);
}

export function useWatchedState(initial: object, options?: WatchedOptions) {
    currentRenderRun || throwError("useWatchedState is not used from inside a WatchedComponent");

    const [state]  = useState(initial);
    return watched(state);
}

/**
 * Records the values, that are **immediately** accessed in the loader function. Treats them as dependencies and re-executes the loader when any of these change.
 * <p>
 * Opposed to {@link load}, it does not treat all previously accessed properties as dependencies
 * </p>
 * <p>
 * Immediately means: Before the promise is returned. I.e. does not record any more after your fetch finished.
 * </p>
 * @param loader
 */
function useLoad<T>(loader: () => Promise<T>): T {
    return undefined as T;
}

type LoadOptions = {
    /**
     * If you specify a fallback, the component can be immediately rendered during loading.
     * <p>
     * undefined = undefined as fallback.
     * </p>
     */
    fallback?: unknown

    /**
     * Performance: Set to false, to mark following `load(...)` statements do not depend on the result. I.e when used only for immediate rendering or passed to child components only. I.e. <div>{load(...)}/div> or `<MySubComponent param={load(...)} />`:
     * Therefore, the following `load(...)` statements may not need a reload and can run in parallel.
     * <p>
     *     Default: true
     *  </p>
     */
    critical?: boolean

    // Seems not possible because loaderFn is mostly an anonymous function and cannot be re-identified
    // /**
    //  * Values which the loaderFn depends on. If any of these change, it will do a reload.
    //  * <p>
    //  *     By default it will do a very safe and comfortable in-doubt-do-a-reload, meaning: It depends on the props + all `usedWatchedState(...)` + all `watched(...)` + the result of previous `load(...)` statements.
    //  * </p>
    //  */
    // deps?: unknown[]

    /**
     * Poll after this amount of milliseconds
     */
    poll?: number
}
export function load<T,FALLBACK>(loaderFn: () => Promise<T>, options?: Omit<LoadOptions, "fallback">): T
export function load<T,FALLBACK>(loaderFn: () => Promise<T>, options: LoadOptions & {fallback: FALLBACK}): T | FALLBACK
export function load(loaderFn: () => Promise<unknown>, options: LoadOptions = {}): any {
    // Wording:
    // - "previous" means: load(...) statements more upwards in the user's code
    // - "last" means: this load call but from a past render run.

    // Validity checks:
    typeof loaderFn === "function" || throwError("loaderFn is not a function");
    if(currentRenderRun === undefined) throw new Error("load is not used from inside a WatchedComponent")

    const hasFallback = options.hasOwnProperty("fallback");
    const renderRun = currentRenderRun;
    const recordedReadsSincePreviousLoadCall = renderRun.recordedReads; renderRun.recordedReads = []; // Pop recordedReads
    let lastLoadCall = renderRun.loadCallIndex < renderRun.persistent.loadCalls.length?renderRun.persistent.loadCalls[renderRun.loadCallIndex]:undefined;

    try {
        if(renderRun.persistent.passiveRenderForStateIndicator) { // Passive render ?
            // Don't look at recorded reads. Assume the order has not changed

            // Validity check:
            if(lastLoadCall === undefined) {
                throw new Error("More load(...) statements in render run for status indication seen than last time. someLoading()'s result must not influence the structure/order of load(...) statements.");
            }

            //** return lastLoadCall.result:
            if(lastLoadCall.result.state === "resolved") {
                return watched(lastLoadCall.result.resolvedValue);
            }
            else if(lastLoadCall?.result.state === "rejected") {
                throw lastLoadCall.result.rejectReason;
            }
            else if(lastLoadCall.result.state === "pending") {
                throw lastLoadCall.result.promise;
            }
            else {
                throw new Error("Unhandled state");
            }
        }

        let result = inner();
        if(options.critical !== false) {
            renderRun.recordedReads.push(new RecordedValueRead(result)); // Add as dependency for the next loads
        }
        return watched(result);
    }
    finally {
        renderRun.loadCallIndex++;
    }



    function inner()  {
        const recordedReadsAreEqualSinceLastCall = lastLoadCall && recordedReadsArraysAreEqual(recordedReadsSincePreviousLoadCall, lastLoadCall.recordedReadsBefore)
        if(!recordedReadsAreEqualSinceLastCall) {
            renderRun.persistent.loadCalls = renderRun.persistent.loadCalls.slice(0, renderRun.loadCallIndex); // Erase all snaphotted loadCalls after here (including this one).
            lastLoadCall = undefined;
        }

        /**
         * Can we use the result from last call ?
         */
        const canReuseLastResult = () => {
            if(!lastLoadCall) { // call was not recorded last render or is invalid?
                return false;
            }
            if (!recordedReadsAreEqualSinceLastCall) {
                return false;
            }

            if (lastLoadCall.recordedReadsInsideLoaderFn.some((r => r.isChanged))) { // I.e for "load( () => { fetch(props.x, myLocalValue) }) )" -> props.x or myLocalValue has changed?
                return false;
            }

            if (lastLoadCall.result.state === "resolved") {
                return {result: lastLoadCall.result.resolvedValue}
            }
            if (lastLoadCall.result.state === "pending") {
                renderRun.somePending = lastLoadCall.result.promise;
                renderRun.somePendingAreCritical ||= (options.critical !== false);
                if (hasFallback) { // Fallback specified ?
                    return {result: options.fallback};
                }
                throw lastLoadCall.result.promise; // Throwing a promise will put the react component into suspense state
            } else if (lastLoadCall.result.state === "rejected") {
                throw lastLoadCall.result.rejectReason;
            } else {
                throw new Error("Invalid state of lastLoadCall.result.state")
            }
        }

        const canReuse = canReuseLastResult();
        if (canReuse !== false) { // can re-use ?
            const lastCall = renderRun.persistent.loadCalls[renderRun.loadCallIndex];

            lastCall.recordedReadsInsideLoaderFn.forEach(read => {
                // Re-render on a change of the read value:
                const changeListener = (newValue: unknown) => {
                    if (currentRenderRun) {
                        throw new Error("You must not modify a watched object during the render run.");
                    }
                    renderRun.handleWatchedPropertyChange();
                }
                renderRun.startPropChangeListeningFns .push(() => read.onChange (changeListener));
                renderRun.cleanUpPropChangeListenerFns.push(() => read.offChange(changeListener));
            })

            return canReuse.result; // return proxy'ed result from last call:
        }
        else { // cannot use last result ?
            if(renderRun.somePending && renderRun.somePendingAreCritical) { // Performance: Some previous (and dependent) results are pending, so loading this one would trigger a reload soon
                // don't make a new call
                if(hasFallback) {
                    return options.fallback!;
                }
                else {
                    throw renderRun.somePending;
                }
            }

            // *** make a loadCall / exec loaderFn ***:

            let loadCall = new RecordedLoadCall();
            loadCall.recordedReadsBefore = recordedReadsSincePreviousLoadCall;
            const resultPromise = Promise.resolve(loaderFn()); // Exec loaderFn
            loadCall.recordedReadsInsideLoaderFn = renderRun.recordedReads; renderRun.recordedReads = []; // pop and remember the (immediate) reads from inside the loaderFn

            resultPromise.then((value) => {
                loadCall.result = {state: "resolved", resolvedValue: value}
            })
            resultPromise.catch(reason => {
                loadCall.result = {state: "rejected", rejectReason: reason}
            })
            loadCall.result = {state: "pending", promise: resultPromise};

            renderRun.persistent.loadCalls[renderRun.loadCallIndex] = loadCall; // add / replace

            renderRun.somePending = resultPromise;
            renderRun.somePendingAreCritical ||= (options.critical !== false);

            if (hasFallback) { // Fallback specified ?
                loadCall.result.promise.then((result) => {
                    if(result === null || (!(typeof result === "object")) && result === options.fallback) { // Result is primitive and same as fallback ?
                        // Loaded value did not change / No re-render needed because the fallback is already displayed
                    }
                    else {
                        renderRun.persistent.handleLoadedValueChanged();
                    }
                })
                loadCall.result.promise.catch((error) => {
                    renderRun.persistent.handleLoadedValueChanged(); // Re-render. The next render will see state=rejected for this load statement and throw it then.
                })
                return options.fallback!;
            }

            throw resultPromise; // Throwing a promise will put the react component into suspense state
        }
    }

    function watched(value: unknown) { return (value !== null && typeof value === "object")?renderRun.watchedGraph.getProxyFor(value):value }
}

/**
 *
 * @return A promise, when some load(...) statement from directly inside this watchedComponent function is currently loading. Undefined when nothing is loading.
 */
export function someLoading(): Promise<unknown> | undefined {
    // Validity check:
    if(currentRenderRun === undefined) throw new Error("load is not used from inside a WatchedComponent")

    if(currentRenderRun.persistent.passiveRenderForStateIndicator !== undefined) { // is passive render ?
        return currentRenderRun.persistent.passiveRenderForStateIndicator.somePending;
    }
    currentRenderRun.passiveRenderForStateIndicatorRequested = true; // Request passive render.
    return undefined;
}

export function nextLoading() {
    // Should we pre-associate index->RecordedLoadCall ?: Or post associate it on the passive run ?
    // Pre-assoc: We can hide the load statement when loading. But this violates the load structure/order. Can we allow it just for the last one?
}

export function prevLoading() {

}

/**
 * graph.createProxyFor(props) errors when props's readonly properties are accessed.
 * So instead, this functions does not proxy the **whole** props but each prop individually
 * @param graph
 * @param props
 */
function createProxyForProps<P extends object>(graph: WatchedGraph, props: P): P {
    // TODO: see ShouldReLoadIfPropsPropertyChanges.
    const result = {}
    Object.keys(props).forEach(key => {
        //@ts-ignore
        const value = props[key];
        Object.defineProperty(result, key,  {
            value: (value!= null && typeof value === "object")?graph.getProxyFor(value):value,
            writable: false
        })
    })
    return result as P;
}