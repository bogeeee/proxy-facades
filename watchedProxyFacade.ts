import {
    FacadeProxyHandler,
    IWatchedProxyHandler_common,
    ProxyFacade,
    RecordedReadOnProxiedObject,
    runChangeOperation
} from "./proxyFacade";
import {throwError} from "./Util";
import {    AfterReadListener,
    ChangeListener,
    checkEsRuntimeBehaviour, EventHook,
    getPropertyDescriptor,
    objectMembershipInGraphs,
    ObjKey,
    RecordedRead,
    UnspecificObjectChange,
} from "./common";
import {getChangeHooksForObject, changeHooksForObject} from "./objectChangeTracking";
import _ from "underscore"
import {getTrackingConfigFor} from "./class-trackers/index";
import {RecordedReadOnProxiedObjectExt} from "./RecordedReadOnProxiedObjectExt";


/**
 * Access a single value (=variable or return value from a function)
 * This read is can only be constructed manually (not through a WatchedProxyFacade / WatchedProxyHandler
 */
export class RecordedValueRead extends RecordedRead{
    value: unknown;

    constructor(value: unknown) {
        super();
        this.value = value;
    }

    get isChanged(): boolean {
        throw new Error("Cannot check if simple value (not on object) has changed.");
    }

    onAfterChange(listener: () => void, trackOriginal = false) {
        throw new Error("Cannot listen for changes on simple value (not on object)");
    }

    offAfterChange(listener: () => void) {
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedValueRead)) {
            return false;
        }

        return this.value === other.value;
    }
}

export class RecordedPropertyRead extends RecordedReadOnProxiedObjectExt {
    key!: ObjKey;
    value!: unknown;


    constructor(key: ObjKey, value: unknown) {
        super();
        this.key = key;
        this.value = value;
    }

    get isChanged() {
        //@ts-ignore
        return this.obj[this.key] !== this.value;
    }

    getAffectingChangeHooks(target: this["obj"]) {
        const result = [
            getChangeHooksForObject(target).changeSpecificProperty.get(this.key)
        ]
        if(Array.isArray(this.obj)) {
            result.push(getChangeHooksForObject(target).unspecificChange);
        }
        return result;
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedPropertyRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && this.key === other.key && this.value === other.value;
    }
}

export class RecordedOwnKeysRead extends RecordedReadOnProxiedObjectExt{
    value!: ArrayLike<string | symbol>;

    constructor(value: RecordedOwnKeysRead["value"]) {
        super();
        this.value = value;
    }

    get isChanged() {
        return !_.isEqual(Reflect.ownKeys(this.obj), this.value);
    }

    getAffectingChangeHooks(target: this["obj"]) {
        const result = [
            getChangeHooksForObject(target).changeOwnKeys
        ]
        if(Array.isArray(this.obj)) {
            result.push(getChangeHooksForObject(target).unspecificChange);
        }
        return result;
    }

    equals(other: RecordedRead) {
        if(! (other instanceof RecordedOwnKeysRead)) {
            return false;
        }

        return this.proxyHandler === other.proxyHandler && this.obj === other.obj && _.isEqual(this.value, other.value);
    }
}

/**
 * Fired when a method was called that is not implemented in the supervisor. May be from a future js version
 */
export class RecordedUnspecificRead extends RecordedReadOnProxiedObjectExt{
    get isChanged() {
        return true;
    }

    getAffectingChangeHooks(target: this["obj"]) {
        return [
            getChangeHooksForObject(target).anyChange
        ]
    }

    equals(other: RecordedRead) {
        return false;
    }
}


/**
 * Use cases:
 * - record read + watch recorded for modifications. For re-render trigger
 * - record read and make several snapshots (when load is called) and compare exactly those reads
 */
export class WatchedProxyFacade extends ProxyFacade<WatchedProxyHandler> {
    // ** Configuration**

    trackReadsOnPrototype = false;

    // *** State: ****

    /**
     * Called after a read has been made to any object inside this facade
     * @protected
     */
    _afterReadListeners = new Set<AfterReadListener>()


    onAfterRead(listener: AfterReadListener) {
        this._afterReadListeners.add(listener);
    }

    offAfterRead(listener: AfterReadListener) {
        this._afterReadListeners.delete(listener);
    }

    constructor() {
        super();
        checkEsRuntimeBehaviour();
    }

    /**
     * Watches for writes on a specified property
     * @param obj
     * @param key Not restricted here (for the tests), but it must not be number !
     * @param listener
     */
    onAfterWriteOnProperty<O extends  object, K extends keyof O>(obj: O, key: K, listener:  ChangeListener) {
        getChangeHooksForObject(obj).changeSpecificProperty.get(key as ObjKey).afterListeners.add(listener);
    }

    /**
     * Watches for writes on a specified property
     * @param obj
     * @param key Not restricted here (for the tests), but it must not be number !
     * @param listener
     */
    offAfterWriteOnProperty<O extends  object, K extends keyof O>(obj: O, key: K, listener:  ChangeListener) {
        changeHooksForObject.get(obj)?.changeSpecificProperty.get(key as ObjKey).afterListeners.delete(listener);
    }

    protected crateHandler(target: object, facade: any): WatchedProxyHandler {
        return new WatchedProxyHandler(target, facade);
    }
}

export class WatchedProxyHandler extends FacadeProxyHandler<WatchedProxyFacade> implements  IWatchedProxyHandler_common{

    constructor(target: object, facade: WatchedProxyFacade) {
        super(target, facade);
    }

    get trackingConfig() {
        return getTrackingConfigFor(this.target); // TODO: cache (performance)
    }

    fireAfterRead(read: RecordedReadOnProxiedObject) {
        read.proxyHandler = this;
        read.obj = this.target;

        this.facade._afterReadListeners.forEach(l => l(read)); // Inform listeners
    }

    getFacade() {
        return this.facade;
    }

    get (fake_target:object, key:string | symbol, receiver:any) {
        const target = this.target;
        const proxy = this.proxy;
        const thisHandler = this;
        const receiverMustBeNonProxied = this.trackingConfig?.receiverMustBeNonProxied === true;

        if(key === "_watchedProxyHandler") { // TODO: use symbol for that (performance)
            return this;
        }
        if(key === "_target") { // TODO: use symbol for that (performance)
            return this.target;
        }

        // Check for and use supervisor class:
        if(this.trackingConfig !== undefined) {
            for(const TrackerClass of this.trackingConfig.getTrackerClasses()) {
                let propOnSupervisor = Object.getOwnPropertyDescriptor(TrackerClass.prototype, key);
                if(propOnSupervisor !== undefined) { // Supervisor class is responsible for the property (or method) ?
                    //@ts-ignore
                    if(propOnSupervisor.get) { // Prop is a getter?
                        return this.facade.getProxyFor(propOnSupervisor.get.apply(this.proxy));
                    }
                    if(propOnSupervisor.set) { // Prop is a setter ?
                        throw new Error("setters not yet implemented")
                    }
                    else {
                        typeof propOnSupervisor.value === "function" || throwError(`Accessing supervisor's plain property: ${String(key)}`); // validity check
                        const supervisorMethod = propOnSupervisor.value;
                        return supervisorMethod;
                    }
                }
            }
            // When arriving here, the field is not **directly** in one of the tracker classes
            //@ts-ignore
            origMethod = this.target[key];
            if(this.trackingConfig.knownHighLevelMethods.has(key)) {
                return trapHighLevelReaderWriterMethod
            }

            if(typeof origMethod === "function" && !(key as any in Object.prototype)) { // Read+write method that was not handled directly by supervisor class?
                if(this.trackingConfig.readOnlyMethods.has(key)) {
                    return trapForGenericReaderMethod
                }
                else {
                    return trapForGenericReaderWriterMethod // Assume the worst, that it is a writer method
                }
            }
        }

        return super.get(fake_target, key, receiver);


        var origMethod: ((this:unknown, ...args:unknown[]) => unknown) | undefined = undefined;
        /**
         * Fires a RecordedUnspecificRead
         */
        function trapForGenericReaderMethod(this:object, ...args: unknown[]) {
            const callResult = origMethod!.apply(receiverMustBeNonProxied?target:this, args); // call original method:
            if(thisHandler.trackingConfig?.trackTreads !== false) { // not explicitly disabled ?
                thisHandler.fireAfterRead(new RecordedUnspecificRead());
            }
            return thisHandler.trackingConfig?.proxyUnhandledMethodResults?thisHandler.facade.getProxyFor(callResult):callResult;
        }
        /**
         * Fires a RecordedUnspecificRead and calls the unspecificChange listeners
         * @param args
         */
        function trapForGenericReaderWriterMethod(this:object, ...args: unknown[]) {
            return runChangeOperation(proxy, new UnspecificObjectChange(proxy),[getChangeHooksForObject(proxy).unspecificChange],() => {
                const callResult = origMethod!.apply(receiverMustBeNonProxied?target:this, args); // call original method:
                if(thisHandler.trackingConfig?.trackTreads !== false) { // not explicitly disabled ?
                    thisHandler.fireAfterRead(new RecordedUnspecificRead());
                }
                return thisHandler.trackingConfig?.proxyUnhandledMethodResults?thisHandler.facade.getProxyFor(callResult):callResult;
            });
        }
        /**
         * Wraps it in runAndCallListenersOnce_after
         * @param args
         */
        function trapHighLevelReaderWriterMethod(this:object, ...args: unknown[]) {
            return runChangeOperation(proxy, undefined,[],() => {
                return origMethod!.apply(this, args);  // call original method
            });
        }
    }

    rawRead(key: ObjKey) {
        const result = super.rawRead(key);
        if(!this.facade.trackReadsOnPrototype) {
            if(Object.getOwnPropertyDescriptor(this.target, key) === undefined && getPropertyDescriptor(this.target,key ) !== undefined) { // Property is on prototype only ?
                return result;
            }
        }
        if(this.trackingConfig?.trackTreads !== false) { // not explicitly disabled ?
            this.fireAfterRead(new RecordedPropertyRead(key, result)); // Inform listeners
        }
        return result;
    }

    protected rawChange(key: string | symbol, newUnproxiedValue: any) {
        const changeHooksForThisObject = getChangeHooksForObject(this.proxy);
        const hooksToServe: EventHook[] = [];

        if (this.isForArray()) {
            hooksToServe.push(changeHooksForThisObject.unspecificChange);
        }

        hooksToServe.push(changeHooksForThisObject.changeSpecificProperty.get(key));
        hooksToServe.push(changeHooksForThisObject.changeAnyProperty);

        const isNewProperty = getPropertyDescriptor(this.target, key) === undefined;
        if (isNewProperty) {
            hooksToServe.push(changeHooksForThisObject.changeOwnKeys);
        }

        runChangeOperation(this.proxy, new UnspecificObjectChange(this.proxy),hooksToServe,() => {
            super.rawChange(key, newUnproxiedValue);
        });
    }

    deleteProperty(target: object, key: string | symbol): boolean {
        const doesExists = Object.getOwnPropertyDescriptor(this.target, key) !== undefined;
        if (!doesExists) {
            return true;
        }

        return runChangeOperation(this.proxy, new UnspecificObjectChange(this.proxy),[getChangeHooksForObject(this.proxy).changeOwnKeys],() => {
            this.set(target, key, undefined, this.proxy); // Set to undefined first, so property change listeners will get informed
            return super.deleteProperty(target, key);
        });
    }

    ownKeys(target: object): ArrayLike<string | symbol> {
        const result = Reflect.ownKeys(this.target);
        if(this.trackingConfig?.trackTreads !== false) { // not explicitly disabled ?
            this.fireAfterRead(new RecordedOwnKeysRead(result))
        }
        return result;
    }

    isForArray() {
        return Array.isArray(this.target)
    }

    isForSet() {
        return this.target instanceof Set;
    }

    isForMap() {
        return this.target instanceof Map;
    }
}