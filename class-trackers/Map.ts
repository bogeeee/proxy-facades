import {
    ChangeListener, EventHook, ClassTrackingConfiguration,
    makeIteratorTranslateValue,
    ObjKey,
    RecordedRead,
    UnspecificObjectChange
} from "../common";
import {getChangeHooksForObject, changeHooksForObject} from "../objectChangeTracking";
import {arraysAreShallowlyEqual, arraysWithEntriesAreShallowlyEqual, MapSet, newDefaultMap} from "../Util";
import {installChangeTracker} from "../origChangeTracking";
import {WatchedProxyHandler} from "../watchedProxyFacade";
import {RecordedReadOnProxiedObjectExt} from "../RecordedReadOnProxiedObjectExt";
import {
    DualUseTracker,
    dualUseTracker_callOrigMethodOnTarget,
    ForWatchedProxyHandler, IWatchedProxyHandler_common, RecordedReadOnProxiedObject,
    runChangeOperation
} from "../proxyFacade";


/**
 * Hooks for one map.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectChangeHooks} are also subscribed on Maps
 */
class MapChangeHooks {
    specificKeyAddedOrRemoved = newDefaultMap<unknown, EventHook>( () => new EventHook());
    anyKeyAddedOrRemoved = new EventHook();

    specificValueChanged = newDefaultMap<unknown, EventHook>( () => new EventHook());
    anyValueChanged = new EventHook();
}

export const changeHooksForMap = new WeakMap<Map<unknown,unknown>, MapChangeHooks>();
export function getChangeHooksForMap(map: Map<unknown,unknown>) {
    let result = changeHooksForMap.get(map);
    if(result === undefined) {
        changeHooksForMap.set(map, result = new MapChangeHooks());
    }
    return result;
}

/**
 * Can be either used as a supervisor-class in a WatchedProxyHandler, or installed on the non-proxied object via Object.setPrototypeOf
 * The "this" may be different in these cases.
 */
export class MapChangeTracker<K,V> extends Map<K,V> implements DualUseTracker<Map<K,V>>{

    get _watchedProxyHandler(): IWatchedProxyHandler_common | undefined {
        return undefined;
    }

    protected _withUnspecificChange<R>(changeFn: () => R): R {
        return runChangeOperation(this, new UnspecificObjectChange(this), [getChangeHooksForObject(this).unspecificChange], changeFn)
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

        const hooksForThisMap = getChangeHooksForMap(this);
        const hooksToServe = [
            ...(isNewKey?[hooksForThisMap.specificKeyAddedOrRemoved.get(key), hooksForThisMap.anyKeyAddedOrRemoved]:[]),
            ...(valueChanged?[hooksForThisMap.specificValueChanged.get(key), hooksForThisMap.anyValueChanged]:[])
        ];
        runChangeOperation(this, new UnspecificObjectChange(this),hooksToServe,() => {
            return dualUseTracker_callOrigMethodOnTarget(this, "set", [key, value])
        });

        return this;
    }

    delete(key: K): boolean {
        key = this._watchedProxyHandler?this._watchedProxyHandler.getFacade().getUnproxiedValue(key):key; // Translate to unproxied key

        if(!this._target.has(key)) { // no change?
            return false;
        }

        const hooksForThisMap = getChangeHooksForMap(this);
        const hooksToServe = [hooksForThisMap.specificKeyAddedOrRemoved.get(key),hooksForThisMap.anyKeyAddedOrRemoved,hooksForThisMap.specificValueChanged.get(key),hooksForThisMap.anyValueChanged];
        return runChangeOperation(this, new UnspecificObjectChange(this),hooksToServe,() => {
            return dualUseTracker_callOrigMethodOnTarget(this, "delete", [key]);
        });
    }

    clear() {
        const hooksToServe = [getChangeHooksForMap(this).anyKeyAddedOrRemoved, getChangeHooksForMap(this).anyValueChanged, getChangeHooksForObject(this).unspecificChange];
        return runChangeOperation(this, new UnspecificObjectChange(this),hooksToServe,() => {
            return dualUseTracker_callOrigMethodOnTarget(this, "clear", []);
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
    declare origObj: Map<unknown, unknown>;


    constructor(key: unknown, keyExists: boolean, value: unknown) {
        super();
        this.key = key;
        this.keyExists = keyExists;
        this.value = value;
    }

    get isChanged() {
        return !(this.keyExists === this.origObj.has(this.key) && this.value === this.origObj.get(this.key));
    }

    getAffectingChangeHooks(target: this["origObj"]) {
        return [
            getChangeHooksForMap(target).specificKeyAddedOrRemoved.get(this.key),
            getChangeHooksForMap(target).specificValueChanged.get(this.key),
            getChangeHooksForObject(target).unspecificChange
        ]
    }

    equals(other: RecordedRead) {
        if (!(other instanceof RecordedMap_get)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.origObj === other.origObj && this.key === other.key && this.keyExists == other.keyExists && this.value === other.value;
    }
}

export class RecordedMap_has extends RecordedReadOnProxiedObjectExt {
    key!: unknown;

    /**
     * Result of the .has call
     */
    keyExists: boolean;
    declare origObj: Map<unknown, unknown>;


    constructor(key: unknown, keyExists: boolean) {
        super();
        this.key = key;
        this.keyExists = keyExists;
    }

    get isChanged() {
        return this.keyExists !== this.origObj.has(this.key);
    }

    getAffectingChangeHooks(target: this["origObj"]) {
        return [
            getChangeHooksForMap(target).specificKeyAddedOrRemoved.get(this.key),
            getChangeHooksForObject(target).unspecificChange,
        ]
    }

    equals(other: RecordedRead) {
        if (!(other instanceof RecordedMap_has)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.origObj === other.origObj && this.key === other.key && this.keyExists === other.keyExists;
    }
}

export class RecordedMapKeysRead extends RecordedReadOnProxiedObjectExt {
    keys: Array<unknown>;
    declare origObj: Map<unknown, unknown>;


    constructor(keys: Array<unknown>) {
        super();
        this.keys = keys;
    }

    getAffectingChangeHooks(target: this["origObj"]) {
        return [
            getChangeHooksForMap(target).anyKeyAddedOrRemoved,
            getChangeHooksForObject(target).unspecificChange
        ]
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapKeysRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.origObj === other.origObj && arraysAreShallowlyEqual(this.keys, other.keys);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.keys, [...(this.origObj).keys()]);
    }
}

export class RecordedMapValuesRead extends RecordedReadOnProxiedObjectExt {
    values: Array<unknown>;

    declare origObj:Map<unknown, unknown>;

    constructor(values: Array<unknown>) {
        super();
        this.values = values;
    }

    getAffectingChangeHooks(target: this["origObj"]) {
        return [
            getChangeHooksForMap(target).anyValueChanged,
            getChangeHooksForObject(target).unspecificChange
        ]
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.origObj === other.origObj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, [...(this.origObj).values()]);
    }
}

export class RecordedMapEntriesRead extends RecordedReadOnProxiedObjectExt {
    values: Array<[unknown, unknown]>;

    declare origObj: Map<unknown, unknown>;


    constructor(values: Array<[unknown, unknown]>) {
        super();
        this.values = values;
    }

    getAffectingChangeHooks(target: this["origObj"]) {
        return [
            getChangeHooksForMap(target).anyKeyAddedOrRemoved,
            getChangeHooksForMap(target).anyValueChanged,
            getChangeHooksForObject(target).unspecificChange
        ]
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedMapEntriesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.origObj === other.origObj && arraysWithEntriesAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysWithEntriesAreShallowlyEqual(this.values, [...(this.origObj).entries()]);
    }
}

export class MapReadTracker<K, V> extends Map<K, V> implements ForWatchedProxyHandler<Map<K, V>> {
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
    readTracker= MapReadTracker;
    changeTracker = MapChangeTracker

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