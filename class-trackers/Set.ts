import {
    AfterWriteListener, dualUseTracker_callOrigMethodOnTarget, ClassTrackingConfiguration,
    DualUseTracker,
    ForWatchedProxyHandler, IWatchedProxyHandler_common, makeIteratorTranslateValue,
    ObjKey,
    RecordedRead,
    RecordedReadOnProxiedObject,
    runAndCallListenersOnce_after
} from "../common";
import {getWriteListenersForObject, writeListenersForObject} from "../origObjectChangeTracking";
import {arraysAreShallowlyEqual, MapSet} from "../Util";
import {WatchedProxyHandler} from "../watchedProxyFacade";
import {RecordedReadOnProxiedObjectExt} from "../RecordedReadOnProxiedObjectExt";


/**
 * Listeners for one set.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Sets
 */
class SetWriteListeners {
    afterSpecificValueChanged = new MapSet<unknown, AfterWriteListener>();
    afterAnyValueChanged = new Set<AfterWriteListener>();
}

export const writeListenersForSet = new WeakMap<Set<unknown>, SetWriteListeners>();
export function getWriteListenersForSet(set: Set<unknown>) {
    let result = writeListenersForSet.get(set);
    if(result === undefined) {
        writeListenersForSet.set(set, result = new SetWriteListeners());
    }
    return result;
}

/**
 * Can be either used as a supervisor-class in a WatchedProxyHandler, or installed on the non-proxied object via Object.setPrototypeOf
 * The "this" may be different in these cases.
 */
export class WriteTrackedSet<T> extends Set<T> implements DualUseTracker<Set<T>>{

    get _watchedProxyHandler(): IWatchedProxyHandler_common | undefined {
        return undefined;
    }

    protected _fireAfterUnspecificWrite() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

    /**
     * Will return the original object when this class is used as supervisor class in the WatchedProxyHandler
     */
    get _target(): Set<T> {
        return this;
    }

    /**
     * Pretend that this is a Set
     */
    get ["constructor"]() {
        return Set;
    }

    add(value:T): this {
        value = this._watchedProxyHandler?this._watchedProxyHandler.getFacade().getUnproxiedValue(value):value; // Translate to unproxied value

        if(this._target.has(value)) { // No change?
            return this;
        }
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = dualUseTracker_callOrigMethodOnTarget(this, "add", [value]);
            callListeners(writeListenersForSet.get(this._target)?.afterSpecificValueChanged.get(value));
            callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
        return this;
    }

    delete(value: T): boolean {
        value = this._watchedProxyHandler?this._watchedProxyHandler.getFacade().getUnproxiedValue(value):value; // Translate to unproxied value
        return runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = dualUseTracker_callOrigMethodOnTarget(this, "delete", [value]);
            if(result) { // deleted?
                callListeners(writeListenersForSet.get(this._target)?.afterSpecificValueChanged.get(value));
                callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
                callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
            }
            return result
        });
    }

    clear() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = dualUseTracker_callOrigMethodOnTarget(this, "clear", []);
            callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

}

export class RecordedSet_has extends RecordedReadOnProxiedObjectExt {
    value!: unknown;
    /**
     * Result of the .has call
     */
    result: boolean;
    obj!: Set<unknown>;


    constructor(value: unknown, result: boolean) {
        super();
        this.value = value;
        this.result = result;
    }

    get isChanged() {
        return this.result !== this.obj.has(this.value);
    }

    getAffectingChangeListenerSets(target: this["obj"]) {
        return [
            getWriteListenersForSet(target).afterSpecificValueChanged.get4use(this.value),
            getWriteListenersForObject(target)?.afterUnspecificWrite
        ];
    }

    equals(other: RecordedRead) {
        if (!(other instanceof RecordedSet_has)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.value === other.value && this.result === other.result;
    }
}

export class RecordedSetValuesRead extends RecordedReadOnProxiedObjectExt {
    values: Array<unknown>;

    obj!:Set<unknown>;


    constructor(values: Array<unknown>) {
        super();
        this.values = values;
    }

    getAffectingChangeListenerSets(target: this["obj"]) {
        return [
            getWriteListenersForSet(target).afterAnyValueChanged,
            getWriteListenersForObject(target).afterUnspecificWrite
        ]
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedSetValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, [...(this.obj).values()]);
    }
}

export class WatchedSet_for_WatchedProxyHandler<T> extends Set<T> implements ForWatchedProxyHandler<Set<T>> {
    get _watchedProxyHandler(): WatchedProxyHandler {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the handler when called through the handler
    }

    get _target(): Set<T> {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the value when called through the handler
    }

    protected _fireAfterValuesRead() {
        let recordedSetValuesRead = new RecordedSetValuesRead([...this._target]);
        this._watchedProxyHandler?.fireAfterRead(recordedSetValuesRead);
    }

    /**
     * Pretend that this is a Set
     */
    get ["constructor"]() {
        return Set;
    }

    has(value: T): boolean {
        value = this._watchedProxyHandler.getFacade().getUnproxiedValue(value);
        const result = this._target.has(value);

        const read = new RecordedSet_has(value, result);
        this._watchedProxyHandler?.fireAfterRead(read);

        return result;
    }

    values(): SetIterator<T> {
        const result = this._target.values();
        this._fireAfterValuesRead();
        return makeIteratorTranslateValue(result, (value) => this._watchedProxyHandler.getFacade().getProxyFor(value));
    }

    entries(): SetIterator<[T, T]> {
        const result = this._target.entries();
        this._fireAfterValuesRead();

        const facade = this._watchedProxyHandler.getFacade();
        return makeIteratorTranslateValue<[T, T], SetIterator<[T, T]>/*strange that TS does not infer the types here*/>(result, ([value1,value2]) => [facade.getProxyFor(value1), facade.getProxyFor(value2)]);
    }

    keys(): SetIterator<T> {
        const result = this._target.keys();
        this._fireAfterValuesRead();
        return makeIteratorTranslateValue(result, (value) => this._watchedProxyHandler.getFacade().getProxyFor(value));
    }

    forEach(callbackfn: (value: T, value2: T, set: Set<T>, ...restOfArgs: unknown[]) => void, ...restOfArgs: unknown[]) {
        const getProxyFor: (<T>(val: T)=>T) = (value) => this._watchedProxyHandler.getFacade().getProxyFor(value);

        /**
         * Calls callbackFn but supplies it it's arguments *proxied*
         */
        function callCallbackFnWithProxies(this: Set<T>, value: T, value2: T, set: Set<T>, ...restOfArgs: unknown[]): void{
            callbackfn.apply(this, [getProxyFor(value), getProxyFor(value2), getProxyFor(set), ...restOfArgs]);
        }

        const result = this._target.forEach(callCallbackFnWithProxies, ...restOfArgs);
        this._fireAfterValuesRead();
        return result;
    }

    [Symbol.iterator](): SetIterator<T> {
        const result = this._target[Symbol.iterator]();
        this._fireAfterValuesRead();
        return makeIteratorTranslateValue(result, (value) => this._watchedProxyHandler.getFacade().getProxyFor(value));
    }

    get size(): number {
        const result = this._target.size;
        this._fireAfterValuesRead();
        return result;
    }
}

export const config = new class extends ClassTrackingConfiguration {
    clazz=Set;
    readTracker= WatchedSet_for_WatchedProxyHandler;
    changeTracker = WriteTrackedSet
    receiverMustBeNonProxied = true;
}