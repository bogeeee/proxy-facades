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
import {arraysAreShallowlyEqual, arraysWithEntriesAreShallowlyEqual, MapSet} from "../Util";
import {installWriteTracker} from "../globalWriteTracking";
import {WatchedProxyHandler} from "../watchedProxyFacade";


/**
 * Listeners for one map.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Maps
 */
class MapWriteListeners {
    afterSpecificKeyAddedOrRemoved = new MapSet<unknown, AfterWriteListener>();
    afterAnyKeyAddedOrRemoved = new Set<AfterWriteListener>();

    afterSpecificValueChanged = new MapSet<unknown, AfterWriteListener>();
    afterAnyValueChanged = new Set<AfterWriteListener>();
}

export const writeListenersForMap = new WeakMap<Map<unknown,unknown>, MapWriteListeners>();
export function getWriteListenersForMap(map: Map<unknown,unknown>) {
    let result = writeListenersForMap.get(map);
    if(result === undefined) {
        writeListenersForMap.set(map, result = new MapWriteListeners());
    }
    return result;
}

/**
 * Can be either used as a supervisor-class in a WatchedProxyHandler, or installed on the non-proxied object via Object.setPrototypeOf
 * The "this" may be different in these cases.
 */
export class WriteTrackedMap<K,V> extends Map<K,V> implements DualUseTracker<Map<K,V>>{



    protected _fireAfterUnspecificWrite() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

    /**
     * Will return the original object when this class is used as supervisor class in the WatchedProxyHandler
     */
    get _target(): Map<K, V> {
        return this;
    }

    /**
     * Pretend that this is a Map
     */
    get ["constructor"]() {
        return Map;
    }

    set(key:K, value: V): this {
        const isNewKey = !this._target.has(key);
        const valueChanged = isNewKey || this._target.get(key) !== value;
        if(!isNewKey && !valueChanged) {
            return this;
        }

        runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = Map.prototype.set.apply(this._target, [key, value]); // this.set(key, value); receiver for .set must be the real/nonproxied Map
            if(isNewKey) {
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificKeyAddedOrRemoved.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyKeyAddedOrRemoved);
            }

            if(valueChanged) {
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificValueChanged.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyValueChanged);
            }

            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
        return this;
    }

    delete(key: K): boolean {
        const result = Map.prototype.delete.apply(this._target, [key]); // this.delete(key); receiver for .delete must be the real/nonproxied Map
        if(result) { // deleted?
            runAndCallListenersOnce_after(this._target, (callListeners) => {
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificKeyAddedOrRemoved.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyKeyAddedOrRemoved);
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificValueChanged.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyValueChanged);
                callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
            });
        }
        return result
    }

    clear() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            Map.prototype.clear.apply(this._target, []); // this.clear(); receiver for .clear must be the real/nonproxied Map
            callListeners(writeListenersForMap.get(this._target)?.afterAnyKeyAddedOrRemoved);
            callListeners(writeListenersForMap.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

}

export class RecordedMap_get extends RecordedReadOnProxiedObject {
    key!: unknown;

    keyExists: boolean;
    /**
     * Result of the .get call
     */
    value: unknown;
    obj!: Map<unknown, unknown>;


    constructor(key: unknown, keyExists: boolean, value: unknown) {
        super();
        this.key = key;
        this.keyExists = keyExists;
        this.value = value;
    }

    get isChanged() {
        return !(this.keyExists === this.obj.has(this.key) && this.value === this.obj.get(this.key));
    }

    onChange(listener: () => void, trackOriginal = false) {
        if (trackOriginal) {
            installWriteTracker(this.obj);
        }
        getWriteListenersForMap(this.obj).afterSpecificKeyAddedOrRemoved.add(this.key, listener);
        getWriteListenersForMap(this.obj).afterSpecificValueChanged.add(this.key, listener);
        getWriteListenersForObject(this.obj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        writeListenersForObject.get(this.obj)?.afterUnspecificWrite.delete(listener);
        writeListenersForMap.get(this.obj)?.afterSpecificValueChanged.delete(this.key, listener);
        writeListenersForMap.get(this.obj)?.afterSpecificKeyAddedOrRemoved.delete(this.key, listener);
    }

    equals(other: RecordedRead) {
        if (!(other instanceof RecordedMap_get)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.keyExists == other.keyExists && this.value === other.value;
    }
}

export class RecordedMap_has extends RecordedReadOnProxiedObject {
    key!: unknown;

    /**
     * Result of the .has call
     */
    keyExists: boolean;
    obj!: Map<unknown, unknown>;


    constructor(key: unknown, keyExists: boolean) {
        super();
        this.key = key;
        this.keyExists = keyExists;
    }

    get isChanged() {
        return this.keyExists !== this.obj.has(this.key);
    }

    onChange(listener: () => void, trackOriginal = false) {
        if (trackOriginal) {
            installWriteTracker(this.obj);
        }
        getWriteListenersForMap(this.obj).afterSpecificKeyAddedOrRemoved.add(this.key, listener);
        getWriteListenersForObject(this.obj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        writeListenersForObject.get(this.obj)?.afterUnspecificWrite.delete(listener);
        writeListenersForMap.get(this.obj)?.afterSpecificKeyAddedOrRemoved.delete(this.key, listener);
    }

    equals(other: RecordedRead) {
        if (!(other instanceof RecordedMap_has)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.keyExists === other.keyExists;
    }
}

export class RecordedMapKeysRead extends RecordedReadOnProxiedObject {
    keys: Array<unknown>;

    protected get origObj() {
        return this.obj as Map<unknown, unknown>;
    }


    constructor(keys: Array<unknown>) {
        super();
        this.keys = keys;
    }

    onChange(listener: () => void, trackOriginal = false) {
        if (trackOriginal) {
            installWriteTracker(this.origObj);
        }
        getWriteListenersForMap(this.origObj).afterAnyKeyAddedOrRemoved.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForMap(this.origObj).afterAnyKeyAddedOrRemoved.delete(listener);
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapKeysRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.keys, other.keys);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.keys, [...(this.origObj as Map<unknown, unknown>).keys()]);
    }
}

export class RecordedMapValuesRead extends RecordedReadOnProxiedObject {
    values: Array<unknown>;

    protected get origObj() {
        return this.obj as Map<unknown, unknown>;
    }


    constructor(values: Array<unknown>) {
        super();
        this.values = values;
    }

    onChange(listener: () => void, trackOriginal = false) {
        if (trackOriginal) {
            installWriteTracker(this.origObj);
        }
        getWriteListenersForMap(this.origObj).afterAnyValueChanged.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForMap(this.origObj).afterAnyValueChanged.delete(listener);
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, [...(this.origObj as Map<unknown, unknown>).values()]);
    }
}

export class RecordedMapEntriesRead extends RecordedReadOnProxiedObject {
    values: Array<[unknown, unknown]>;

    protected get origObj() {
        return this.obj as Map<unknown, unknown>;
    }


    constructor(values: Array<[unknown, unknown]>) {
        super();
        this.values = values;
    }

    onChange(listener: () => void, trackOriginal = false) {
        if (trackOriginal) {
            installWriteTracker(this.origObj);
        }
        getWriteListenersForMap(this.origObj).afterAnyKeyAddedOrRemoved.add(listener);
        getWriteListenersForMap(this.origObj).afterAnyValueChanged.add(listener);
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.add(listener);
    }

    offChange(listener: () => void) {
        getWriteListenersForObject(this.origObj).afterUnspecificWrite.delete(listener);
        getWriteListenersForMap(this.origObj).afterAnyValueChanged.delete(listener);
        getWriteListenersForMap(this.origObj).afterAnyKeyAddedOrRemoved.delete(listener);
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapEntriesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysWithEntriesAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysWithEntriesAreShallowlyEqual(this.values, [...(this.origObj as Map<unknown, unknown>).entries()]);
    }
}

export class WatchedMap_for_WatchedProxyHandler<K, V> extends Map<K, V> implements ForWatchedProxyHandler<Map<K, V>> {
    get _WatchedProxyHandler(): WatchedProxyHandler {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the handler when called through the handler
    }

    get _target(): Map<K, V> {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the value when called through the handler
    }

    protected _fireAfterEntriesRead() {
        let recordedMapEntriesRead = new RecordedMapEntriesRead([...this._target.entries()]);
        this._WatchedProxyHandler?.fireAfterRead(recordedMapEntriesRead);
    }

    /**
     * Pretend that this is a Map
     */
    get ["constructor"]() {
        return Map;
    }

    get(key: K): V | undefined {
        const keyExists = this._target.has(key);
        const result = this._target.get(key);

        const read = new RecordedMap_get(key, keyExists, result);
        this._WatchedProxyHandler?.fireAfterRead(read);

        return result;
    }

    has(key: K): boolean {
        const result = this._target.has(key);

        const read = new RecordedMap_has(key, result);
        this._WatchedProxyHandler?.fireAfterRead(read);

        return result;
    }

    values(): MapIterator<V> {
        const result = this._target.values();

        let recordedMapValuesRead = new RecordedMapValuesRead([...result]);
        this._WatchedProxyHandler?.fireAfterRead(recordedMapValuesRead);

        return result;
    }

    entries(): MapIterator<[K, V]> {
        const result = this._target.entries();
        this._fireAfterEntriesRead();
        return result;
    }

    keys(): MapIterator<K> {
        const result = this._target.keys();

        let recordedMapKeysRead = new RecordedMapKeysRead([...result]);
        this._WatchedProxyHandler?.fireAfterRead(recordedMapKeysRead);

        return result;
    }

    forEach(...args: unknown[]) {
        //@ts-ignore
        const result = this._target.forEach(...args);
        this._fireAfterEntriesRead();
        return result;
    }

    [Symbol.iterator](): MapIterator<[K, V]> {
        const result = this._target[Symbol.iterator]();
        this._fireAfterEntriesRead();
        return result;
    }

    get size(): number {
        const result = this._target.size;

        let recordedMapKeysRead = new RecordedMapKeysRead([...this._target.keys()]); // TODO: RecordedMapSizeRead
        this._WatchedProxyHandler?.fireAfterRead(recordedMapKeysRead);

        return result;
    }
}

export const config = new class extends ClassTrackingConfiguration {
    clazz=Map;
    readTracker= WatchedMap_for_WatchedProxyHandler;
    changeTracker = WriteTrackedMap

    /**
     * Built-in Methods, which are using fields / calling methods on the proxy transparently/loyally, so those methods don't call/use internal stuff directly.
     * Tested with, see dev_generateEsRuntimeBehaviourCheckerCode.ts
     * May include read-only / reader methods
     */
    knownHighLevelMethods = new Set<keyof Map<unknown,unknown>>([]) as Set<ObjKey>;

    /**
     * Non-high level
     */
    readOnlyMethods = new Set<keyof Map<unknown,unknown>>([]) as Set<ObjKey>;

    /**
     * Non-high level
     */
    readOnlyFields = new Set<keyof Map<unknown,unknown>>(["size"]) as Set<ObjKey>;

    /**
     * Default, if not listed as high-level method
     */
    eceiverMustBeNonProxied = true;
}