import {
    AfterWriteListener, ClassTrackingConfiguration,
    DualUseTracker, dualUseTracker_callOrigMethodOnTarget,
    ForWatchedProxyHandler, IWatchedProxyHandler_common, makeIteratorTranslateValue,
    ObjKey,
    RecordedRead,
    RecordedReadOnProxiedObject,
    runAndCallListenersOnce_after
} from "../common";
import {getWriteListenersForObject, writeListenersForObject} from "../origObjectChangeTracking";
import {arraysAreShallowlyEqual, arraysWithEntriesAreShallowlyEqual, MapSet} from "../Util";
import {installChangeTracker} from "../origChangeTracking";
import {WatchedProxyHandler} from "../watchedProxyFacade";
import {RecordedReadOnProxiedObjectExt} from "../RecordedReadOnProxiedObjectExt";


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
        key = this._watchedProxyHandler?this._watchedProxyHandler.getFacade().getUnproxiedValue(key):key; // Translate to unproxied key
        value = this._watchedProxyHandler?this._watchedProxyHandler.getFacade().getUnproxiedValue(value):value; // Translate to unproxied value
        
        const isNewKey = !this._target.has(key);
        const valueChanged = isNewKey || this._target.get(key) !== value;
        if(!isNewKey && !valueChanged) {
            return this;
        }

        runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = dualUseTracker_callOrigMethodOnTarget(this, "set", [key, value]);
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
        key = this._watchedProxyHandler?this._watchedProxyHandler.getFacade().getUnproxiedValue(key):key; // Translate to unproxied key
        return runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = dualUseTracker_callOrigMethodOnTarget(this, "delete", [key]);
            if(result) { // deleted?
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificKeyAddedOrRemoved.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyKeyAddedOrRemoved);
                callListeners(writeListenersForMap.get(this._target)?.afterSpecificValueChanged.get(key));
                callListeners(writeListenersForMap.get(this._target)?.afterAnyValueChanged);
                callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
            }
            return result;
        });
    }

    clear() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            const result = dualUseTracker_callOrigMethodOnTarget(this, "clear", []);
            callListeners(writeListenersForMap.get(this._target)?.afterAnyKeyAddedOrRemoved);
            callListeners(writeListenersForMap.get(this._target)?.afterAnyValueChanged);
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

}

export class RecordedMap_get extends RecordedReadOnProxiedObjectExt {
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

    getAffectingChangeListenerSets(target: this["obj"]) {
        return [
            getWriteListenersForMap(target).afterSpecificKeyAddedOrRemoved.get4use(this.key),
            getWriteListenersForMap(target).afterSpecificValueChanged.get4use(this.key),
            getWriteListenersForObject(target).afterUnspecificWrite
        ]
    }

    equals(other: RecordedRead) {
        if (!(other instanceof RecordedMap_get)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.keyExists == other.keyExists && this.value === other.value;
    }
}

export class RecordedMap_has extends RecordedReadOnProxiedObjectExt {
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

    getAffectingChangeListenerSets(target: this["obj"]) {
        return [
            getWriteListenersForMap(target).afterSpecificKeyAddedOrRemoved.get4use(this.key),
            getWriteListenersForObject(target).afterUnspecificWrite,
        ]
    }

    equals(other: RecordedRead) {
        if (!(other instanceof RecordedMap_has)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.keyExists === other.keyExists;
    }
}

export class RecordedMapKeysRead extends RecordedReadOnProxiedObjectExt {
    keys: Array<unknown>;
    obj!: Map<unknown, unknown>;


    constructor(keys: Array<unknown>) {
        super();
        this.keys = keys;
    }

    getAffectingChangeListenerSets(target: this["obj"]) {
        return [
            getWriteListenersForMap(target).afterAnyKeyAddedOrRemoved,
            getWriteListenersForObject(target).afterUnspecificWrite
        ]
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapKeysRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.keys, other.keys);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.keys, [...(this.obj).keys()]);
    }
}

export class RecordedMapValuesRead extends RecordedReadOnProxiedObjectExt {
    values: Array<unknown>;

    obj!:Map<unknown, unknown>;

    constructor(values: Array<unknown>) {
        super();
        this.values = values;
    }

    getAffectingChangeListenerSets(target: this["obj"]) {
        return [
            getWriteListenersForMap(target).afterAnyValueChanged,
            getWriteListenersForObject(target).afterUnspecificWrite
        ]
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, [...(this.obj).values()]);
    }
}

export class RecordedMapEntriesRead extends RecordedReadOnProxiedObjectExt {
    values: Array<[unknown, unknown]>;

    obj!: Map<unknown, unknown>;


    constructor(values: Array<[unknown, unknown]>) {
        super();
        this.values = values;
    }

    getAffectingChangeListenerSets(target: this["obj"]) {
        return [
            getWriteListenersForMap(target).afterAnyKeyAddedOrRemoved,
            getWriteListenersForMap(target).afterAnyValueChanged,
            getWriteListenersForObject(target).afterUnspecificWrite
        ]
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapEntriesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysWithEntriesAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysWithEntriesAreShallowlyEqual(this.values, [...(this.obj).entries()]);
    }
}

export class WatchedMap_for_WatchedProxyHandler<K, V> extends Map<K, V> implements ForWatchedProxyHandler<Map<K, V>> {
    get _watchedProxyHandler(): WatchedProxyHandler {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the handler when called through the handler
    }

    get _target(): Map<K, V> {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the value when called through the handler
    }

    protected _fireAfterEntriesRead() {
        let recordedMapEntriesRead = new RecordedMapEntriesRead([...this._target.entries()]);
        this._watchedProxyHandler?.fireAfterRead(recordedMapEntriesRead);
    }

    /**
     * Pretend that this is a Map
     */
    get ["constructor"]() {
        return Map;
    }

    get(key: K): V | undefined {
        key = this._watchedProxyHandler.getFacade().getUnproxiedValue(key);
        const keyExists = this._target.has(key);
        const result = this._target.get(key);

        const read = new RecordedMap_get(key, keyExists, result);
        this._watchedProxyHandler?.fireAfterRead(read);

        return this._watchedProxyHandler.getFacade().getProxyFor(result);
    }

    has(key: K): boolean {
        key = this._watchedProxyHandler.getFacade().getUnproxiedValue(key);
        const result = this._target.has(key);

        const read = new RecordedMap_has(key, result);
        this._watchedProxyHandler?.fireAfterRead(read);

        return result;
    }

    values(): MapIterator<V> {
        const result = this._target.values();

        let recordedMapValuesRead = new RecordedMapValuesRead([...result]);
        this._watchedProxyHandler?.fireAfterRead(recordedMapValuesRead);

        return makeIteratorTranslateValue(result, (value) => this._watchedProxyHandler.getFacade().getProxyFor(value));
    }

    entries(): MapIterator<[K, V]> {
        const result = this._target.entries();
        this._fireAfterEntriesRead();

        const facade = this._watchedProxyHandler.getFacade();
        return makeIteratorTranslateValue<[K, V], MapIterator<[K, V]>/*strange that TS does not infer the types here*/>(result, ([key,value]) => [facade.getProxyFor(key), facade.getProxyFor(value)]);
    }

    keys(): MapIterator<K> {
        const result = this._target.keys();

        let recordedMapKeysRead = new RecordedMapKeysRead([...result]);
        this._watchedProxyHandler?.fireAfterRead(recordedMapKeysRead);

        return makeIteratorTranslateValue(result, (key) => this._watchedProxyHandler.getFacade().getProxyFor(key));
    }

    forEach(callbackfn: (value: V, key: K, map: Map<K, V>, ...restOfArgs: unknown[]) => void, ...restOfArgs: unknown[]) {
        const getProxyFor: (<T>(val: T)=>T) = (value) => this._watchedProxyHandler.getFacade().getProxyFor(value);

        /**
         * Calls callbackFn but supplies it it's arguments *proxied*
         */
        function callCallbackFnWithProxies(this: Map<K, V>, value: V, key: K, map: Map<K, V>, ...restOfArgs: unknown[]): void{
            callbackfn.apply(this, [getProxyFor(value), getProxyFor(key), getProxyFor(map), ...restOfArgs]);
        }

        const result = this._target.forEach(callCallbackFnWithProxies, ...restOfArgs);
        this._fireAfterEntriesRead();
        return result;
    }

    [Symbol.iterator](): MapIterator<[K, V]> {
        const result = this._target[Symbol.iterator]();
        this._fireAfterEntriesRead();

        const facade = this._watchedProxyHandler.getFacade();
        return makeIteratorTranslateValue<[K, V], MapIterator<[K, V]>/*strange that TS does not infer the types here*/>(result, ([key,value]) => [facade.getProxyFor(key), facade.getProxyFor(value)]);
    }

    get size(): number {
        const result = this._target.size;

        let recordedMapKeysRead = new RecordedMapKeysRead([...this._target.keys()]); // TODO: RecordedMapSizeRead
        this._watchedProxyHandler?.fireAfterRead(recordedMapKeysRead);

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

    receiverMustBeNonProxied = true;
}