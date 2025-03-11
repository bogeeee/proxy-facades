import {
    AfterWriteListener, ClassTrackingConfiguration,
    DualUseTracker,
    ForWatchedProxyHandler,
    ObjKey,
    RecordedRead,
    RecordedReadOnProxiedObject,
    runAndCallListenersOnce_after
} from "../common";
import {getWriteListenersForObject, writeListenersForObject} from "../globalObjectWriteTracking";
import {arraysAreShallowlyEqual, MapSet} from "../Util";
import {installWriteTracker} from "../globalWriteTracking";
import {WatchedProxyHandler} from "../watchedProxyFacade";


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
        if(this._target.has(value)) { // No change?
            return this;
        }
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = Set.prototype.add.apply(this._target, [value]); // this.add(value); receiver for .add must be the real/nonproxied Set
            callListeners(writeListenersForSet.get(this._target)?.afterSpecificValueChanged.get(value));
            callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
        return this;
    }

    delete(value: T): boolean {
        const result = Set.prototype.delete.apply(this._target, [value]); // this.delete(value); receiver for .delete must be the real/nonproxied Set
        if(result) { // deleted?
            runAndCallListenersOnce_after(this._target, (callListeners) => {
                callListeners(writeListenersForSet.get(this._target)?.afterSpecificValueChanged.get(value));
                callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
                callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
            });
        }
        return result
    }

    clear() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            Set.prototype.clear.apply(this._target, []); // this.clear(); receiver for .clear must be the real/nonproxied Set
            callListeners(writeListenersForSet.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

}

export class RecordedSet_has extends RecordedReadOnProxiedObject {
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

    onChange(listener: () => void, trackOriginal = false) {
        if (trackOriginal) {
            installWriteTracker(this.obj);
        }
        getWriteListenersForSet(this.obj).afterSpecificValueChanged.add(this.value, listener);
        getWriteListenersForObject(this.obj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        writeListenersForSet.get(this.obj)?.afterSpecificValueChanged.delete(this.value, listener);
        writeListenersForObject.get(this.obj)?.afterUnspecificWrite.delete(listener);

    }

    equals(other: RecordedRead) {
        if (!(other instanceof RecordedSet_has)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.value === other.value && this.result === other.result;
    }
}

export class RecordedSetValuesRead extends RecordedReadOnProxiedObject {
    values: Array<unknown>;

    protected get origObj() {
        return this.obj as Set<unknown>;
    }


    constructor(values: Array<unknown>) {
        super();
        this.values = values;
    }

    onChange(listener: () => void, trackOriginal = false) {
        if (trackOriginal) {
            installWriteTracker(this.origObj);
        }
        getWriteListenersForSet(this.origObj).afterAnyValueChanged.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForSet(this.origObj).afterAnyValueChanged.delete(listener);
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedSetValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, [...(this.origObj as Set<unknown>).values()]);
    }
}

export class WatchedSet_for_WatchedProxyHandler<T> extends Set<T> implements ForWatchedProxyHandler<Set<T>> {
    get _WatchedProxyHandler(): WatchedProxyHandler {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the handler when called through the handler
    }

    get _target(): Set<T> {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the value when called through the handler
    }

    protected _fireAfterValuesRead() {
        let recordedSetValuesRead = new RecordedSetValuesRead([...this._target]);
        this._WatchedProxyHandler?.fireAfterRead(recordedSetValuesRead);
    }

    /**
     * Pretend that this is a Set
     */
    get ["constructor"]() {
        return Set;
    }

    has(value: T): boolean {
        const result = this._target.has(value);

        const read = new RecordedSet_has(value, result);
        this._WatchedProxyHandler?.fireAfterRead(read);

        return result;
    }

    values(): SetIterator<T> {
        const result = this._target.values();
        this._fireAfterValuesRead();
        return result;
    }

    entries(): SetIterator<[T, T]> {
        const result = this._target.entries();
        this._fireAfterValuesRead();
        return result;
    }

    keys(): SetIterator<T> {
        const result = this._target.keys();
        this._fireAfterValuesRead();
        return result;
    }

    forEach(...args: unknown[]) {
        //@ts-ignore
        const result = this._target.forEach(...args);
        this._fireAfterValuesRead();
        return result;
    }

    [Symbol.iterator](): SetIterator<T> {
        const result = this._target[Symbol.iterator]();
        this._fireAfterValuesRead();
        return result;
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

    /**
     * Built-in Methods, which are using fields / calling methods on the proxy transparently/loyally, so those methods don't call/use internal stuff directly.
     * Tested with, see dev_generateEsRuntimeBehaviourCheckerCode.ts
     * May include read-only / reader methods
     */
    static knownHighLevelMethods = new Set<keyof Set<unknown>>([]) as Set<ObjKey>;

    /**
     * Non-high level
     */
    static readOnlyMethods = new Set<keyof Set<unknown>>([]) as Set<ObjKey>;

    /**
     * Non-high level
     */
    static readOnlyFields = new Set<keyof Set<unknown>>(["size"]) as Set<ObjKey>;

    /**
     * Default, if not listed as high-level method
     */
    static receiverMustBeNonProxied = true;
}