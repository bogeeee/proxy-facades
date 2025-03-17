import {
    ClassTrackingConfiguration,
    DualUseTracker,
    ForWatchedProxyHandler, IWatchedProxyHandler_common, makeIteratorTranslateValue,
    ObjKey,
    RecordedRead,
    RecordedReadOnProxiedObject,
    runAndCallListenersOnce_after
} from "../common";
import {arraysAreShallowlyEqual} from "../Util";
import {getWriteListenersForObject, writeListenersForObject} from "../origObjectWriteTracking";
import {installWriteTracker} from "../origWriteTracking";
import {WatchedProxyHandler} from "../watchedProxyFacade";
import {RecordedReadOnProxiedObjectExt} from "../RecordedReadOnProxiedObjectExt";


/**
 * Listeners for one array.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * {@link ObjectWriteListeners} are also subscribed on Arrays
 */
class ArrayWriteListeners {

}

export const writeListenersForArray = new WeakMap<unknown[], ArrayWriteListeners>();
export function getWriteListenersForArray(array: unknown[]) {
    let result = writeListenersForArray.get(array);
    if(result === undefined) {
        writeListenersForArray.set(array, result = new ArrayWriteListeners());
    }
    return result;
}

/**
 * Can be either used as a supervisor-class in a WatchedProxyHandler, or installed on the non-proxied object via Object.setPrototypeOf
 * The "this" may be different in these cases.
 */
export class WriteTrackedArray<T> extends Array<T> implements DualUseTracker<Array<T>>{


    // TODO: In the future, implement more fine granular change listeners that act on change of a certain index.

    get _watchedProxyHandler(): IWatchedProxyHandler_common | undefined {
        return undefined;
    }

    protected _fireAfterUnspecificWrite() {
        runAndCallListenersOnce_after(this._target, (callListeners) => {
            callListeners(writeListenersForObject.get(this._target)?.afterUnspecificWrite);
            callListeners(writeListenersForObject.get(this._target)?.afterAnyWrite_listeners);
        });
    }

    //push(...items: any[]): number //already calls set

    pop(...args: any[]) {
        //@ts-ignore
        const result = super.pop(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    /**
     * Will return the original object when this class is used as supervisor class in the WatchedProxyHandler
     */
    get _target(): Array<T> {
        return this;
    }

    /**
     * Pretend that this is an array
     */
    get ["constructor"]() {
        return Array;
    }

    shift(...args: any[]): T | undefined {
        //@ts-ignore
        const result = super.shift(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

    //@ts-ignore
    sort(...args: any[]): Array<T> {
        //@ts-ignore
        const result = super.sort(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }


    //@ts-ignore
    fill(...args: any[]): Array<T> {
        //@ts-ignore
        const result = super.fill(...args);
        this._fireAfterUnspecificWrite();
        return result;
    }

}

export class RecordedArrayValuesRead extends RecordedReadOnProxiedObjectExt {
    values: unknown[];

    protected get origObj() {
        return this.obj as unknown[];
    }


    constructor(values: unknown[]) {
        super();
        this.values = values;
    }

    getAffectingChangeListenerSets(target: this["obj"]) {
        return [
            getWriteListenersForObject(target).afterChangeOwnKeys_listeners,
            getWriteListenersForObject(target).afterChangeAnyProperty_listeners,
            getWriteListenersForObject(target).afterUnspecificWrite,
        ]
    }

    equals(other: RecordedRead): boolean {
        if (!(other instanceof RecordedArrayValuesRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && arraysAreShallowlyEqual(this.values, other.values);
    }

    get isChanged(): boolean {
        return !arraysAreShallowlyEqual(this.values, this.origObj);
    }


}

/**
 * Patches methods / accessors
 */
export class WatchedArray_for_WatchedProxyHandler<T> extends Array<T> implements ForWatchedProxyHandler<Array<T>> {
    get _watchedProxyHandler(): WatchedProxyHandler {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the handler when called through the handler
    }

    get _target(): Array<T> {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the value when called through the handler
    }

    protected _fireAfterValuesRead() {
        let recordedArrayValuesRead = new RecordedArrayValuesRead([...this._target]);
        this._watchedProxyHandler?.fireAfterRead(recordedArrayValuesRead);
    }

    /**
     * Pretend that this is an array
     */
    get ["constructor"]() {
        return Array;
    }

    values(): ArrayIterator<T> {
        const result = this._target.values();
        this._fireAfterValuesRead();
        return makeIteratorTranslateValue(result, (value) => this._watchedProxyHandler.getFacade().getProxyFor(value));
    }

    entries(): ArrayIterator<[number, T]> {
        const result = this._target.entries();
        this._fireAfterValuesRead();
        return makeIteratorTranslateValue<[number, T], ArrayIterator<[number, T]>/*strange that TS does not infer the types here*/>(result, ([index,value]) => [index, this._watchedProxyHandler.getFacade().getProxyFor(value)]);
    }

    [Symbol.iterator](): ArrayIterator<T> {
        const result = this._target[Symbol.iterator]();
        this._fireAfterValuesRead();
        return makeIteratorTranslateValue(result, (value) => this._watchedProxyHandler.getFacade().getProxyFor(value));
    }

    get length(): number {
        const result = this._target.length;
        this._fireAfterValuesRead();
        return result;
    }

    //@ts-ignore
    shift(...args: any[]) {
        return runAndCallListenersOnce_after(this._target, (callListeners) => {
            //@ts-ignore
            const result = super.shift(...args);
            callListeners(getWriteListenersForObject(this._target)?.afterChangeOwnKeys_listeners);
            callListeners(getWriteListenersForObject(this._target)?.afterUnspecificWrite);
            callListeners(getWriteListenersForObject(this._target)?.afterAnyWrite_listeners);
            this._fireAfterValuesRead();
            return result;
        });
    }


    /**
     * Keep this method so it it treated as handled and not as making-unspecific-reads
     * @param args
     */
    forEach(...args: any[]) {
        //@ts-ignore
        return super.forEach(...args); //reads "length" an thererfore triggers the read
    }


    //@ts-ignore
    pop(...args: any[]): T | undefined {
        return runAndCallListenersOnce_after(this._target, (callListeners) => {
            //@ts-ignore
            const result = super.pop(...args);
            callListeners(getWriteListenersForObject(this._target)?.afterChangeOwnKeys_listeners);
            callListeners(getWriteListenersForObject(this._target)?.afterUnspecificWrite);
            callListeners(getWriteListenersForObject(this._target)?.afterAnyWrite_listeners);
            this._fireAfterValuesRead();
            return result;
        });

    }

}

export const config = new class extends ClassTrackingConfiguration {
    clazz= Array;
    readTracker= WatchedArray_for_WatchedProxyHandler;
    changeTracker = WriteTrackedArray
    /**
     * Built-in Methods, which are using fields / calling methods on the proxy transparently/loyally, so those methods don't call/use internal stuff directly.
     * Tested with, see dev_generateEsRuntimeBehaviourCheckerCode.ts
     * May include read-only / reader methods
     */
    knownHighLevelMethods = new Set<keyof Array<unknown>>(["at", "concat", "map", "forEach", "join", "slice", "some", "filter", "find", "every", "findIndex", "includes", "indexOf", Symbol.iterator, "lastIndexOf", "push", "reduce", "reduceRight", "toLocaleString", "toString", "unshift", "splice", "copyWithin", "reverse"]) as Set<ObjKey>;

    /**
     * Non-high level. These fire `RecordedUnspecificRead`s then. So better implement them instead to fire i.e RecordedArrayValuesRead.
     */
    readOnlyMethods = new Set<keyof Array<unknown>>(["keys" /* TODO: Implement .keys, mind, that it is different to RecordedOwnKeysRead which allows gaps*/]) as Set<ObjKey>;

    /**
     * Non-high level. Same as above: better implement them
     */
    readOnlyFields = new Set<keyof Array<unknown>>([Symbol.unscopables]) as Set<ObjKey>;

    /**
     *
     */
    receiverMustBeNonProxied = false;

    trackSettingObjectProperties = true;
}