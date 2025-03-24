/**
 *
 */
import {
    ChangeListener,
    ChangeOperation,
    EventHook,
    getPropertyDescriptor,
    GetterFlags,
    objectMembershipInGraphs,
    ObjKey,
    PartialGraph,
    RecordedRead,
    SetterFlags, UnspecificObjectChange
} from "./common";
import {getChangeHooksForObject} from "./objectChangeTracking";
import {newDefaultMap} from "./Util";
import {WatchedProxyHandler} from "./watchedProxyFacade";

let idGenerator=0;
export abstract class ProxyFacade<HANDLER extends FacadeProxyHandler<any>> extends PartialGraph {
    // *** Configuration: ***
    /**
     * Treats them like functions, meaning, they get a proxied 'this'. WatchProxies will see the access to the real properties
     */
    public propertyAccessorsAsWhiteBox = true;
    public trackGetterCalls = false;

    // *** State: ***
    protected objectsToProxyHandlers = new WeakMap<object, HANDLER>();


    /**
     * For react-deepwatch's binding function. Only, when trackGetterCalls is enabled
     */
    public currentOutermostGetter?: GetterCall;

    debug_id = ++idGenerator;

    protected abstract crateHandler(target: object, facade: any): HANDLER;

    getProxyFor<O>(value: O): O {
        if(value === null || typeof value !== "object") { // not an object?
            return value;
        }

        if(this.hasObj(value)) { // Already our proxied object ?
            return value;
        }

        let handlerForObj = this.objectsToProxyHandlers.get(value);
        if(handlerForObj !== undefined) { // value was an unproxied object and we have the proxy for it ?
            return handlerForObj.proxy as O;
        }

        handlerForObj = this.crateHandler(value, this);
        // register:
        proxyToProxyHandler.set(handlerForObj.proxy, handlerForObj);
        this.objectsToProxyHandlers.set(value, handlerForObj);
        this._register(handlerForObj.proxy);


        return handlerForObj.proxy as O;
    }

    /**
     *
     * @param value
     * @return the original non-proxied- (by exactly this facade) value
     */
    getUnproxiedValue<O>(value: O): O {
        if(value === null || typeof value !== "object") { // not an object?
            return value;
        }

        const handler = proxyToProxyHandler.get(value);
        if(handler && handler.facade === this) {
            return handler.target as O;
        }
        return value;
    }

    getHandlerFor(obj: object) {
        return getProxyHandler(this.getProxyFor(obj)) as HANDLER;
    }

}

export abstract class FacadeProxyHandler<FACADE extends ProxyFacade<any>> implements ProxyHandler<object> {
    target: object;
    proxy: object;
    facade: FACADE;

    constructor(target: object, facade: FACADE) {
        this.target = target;
        this.facade = facade;

        // Create proxy:
        //const targetForProxy = {}; // The virtual way
        const targetForProxy=target // Preserves Object.keys and instanceof behaviour :), iterators and other stuff. But the downside with this is, that it does not allow to proxy read only properties
        this.proxy = new Proxy(targetForProxy, this);
    }

    deleteProperty(target: object, key: string | symbol): boolean {
        //@ts-ignore
        return deleteProperty(this.target,key);
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Must not use defineProperty on a proxied object. Handling of change tracking etc. for this may not be implemented");
    }

    get (fake_target:object, p:string | symbol, receiver:any) {
        // Validity check
        if(receiver !== this.proxy) {
            throw new Error("Invalid state. Get was called on a different object than this proxy  is for."); // Cannot imagine a legal case
        }

        const getter = getPropertyDescriptor(this.target, p)?.get;
        let value;
        if(this.facade.propertyAccessorsAsWhiteBox && getter !== undefined && (getter as GetterFlags).origHadGetter !== false) { // Access via real property accessor ?
            const isOuter = this.facade.currentOutermostGetter === undefined;
            if(this.facade.trackGetterCalls && isOuter) {
                this.facade.currentOutermostGetter = new GetterCall(this.proxy, p);
            }
            try {
                return value = getter.apply(this.proxy, []); // Call the accessor with a proxied this
            }
            finally {
                if(this.facade.trackGetterCalls && isOuter) {
                    this.facade.currentOutermostGetter = undefined
                }
            }
        }
        else {
            //@ts-ignore
            value = this.rawRead(p);
        }

        if(value != null && typeof value === "object") {
            const descriptor = Object.getOwnPropertyDescriptor(this.target, p);

            // Handle read-only property:
            if(descriptor !== undefined && descriptor.writable === false) {
                // The js runtime would prevent us from returning a proxy :( Pretty mean :(
                throw new Error("Cannot proxy a read-only property. This is not implemented."); // TODO: Implement the virtual way (see constructor)
            }

            return this.facade.getProxyFor(value);
        }

        return value;
    }

    protected rawRead(key: ObjKey): unknown {
        //@ts-ignore
        return this.target[key as any];
    }

    set(fake_target:object, p:string | symbol, value:any, receiver:any) {
        // Validity check
        if(receiver !== this.proxy) {
            throw new Error("Invalid state. Set was called on a different object than this proxy  is for."); // Cannot imagine a legal case
        }

        const setter = getPropertyDescriptor(this.target, p)?.set;
        if(this.facade.propertyAccessorsAsWhiteBox && setter !== undefined && (setter as SetterFlags).origHadSetter !== false) { // Setting via real property accessor ?
            setter.apply(this.proxy,[value]); // Only call the accessor with a proxied this
        }
        else {
            const unproxiedValue = this.facade.getUnproxiedValue(value);
            //@ts-ignore
            if (this.target[p] !== unproxiedValue) { // modify ?
                this.rawChange(p, unproxiedValue);
            }
        }
        return true
    }

    protected rawChange(p: string | symbol, newUnproxiedValue: any) {
        //@ts-ignore
        this.target[p] = newUnproxiedValue
    }



}


const proxyToProxyHandler = new WeakMap<object, FacadeProxyHandler<any>>();
function getProxyHandler(proxy: object) {
    return proxyToProxyHandler.get(proxy);
}

export function isProxyForAFacade(obj: object) {
    return proxyToProxyHandler.has(obj);
}

/**
 * Makes the obj throw an error when trying to access it
 * @param obj
 * @param message
 * @param cause
 */
export function invalidateObject(obj: object, message: string, cause?: Error) {
    const throwInvalid = () => {
        //ts-ignore TS2554 Expected 0-1 arguments, but got 2  - produces compile error when downstream projects include this lib and compile for <=ES2020.
        throw new Error(message, {cause: cause});
    }

    // Delete all writeable  own props:
    const descrs = Object.getOwnPropertyDescriptors(obj);
    for(const k in descrs) {
        const desc = descrs[k];
        if(desc.configurable) {
            //@ts-ignore
            delete obj[k];
        }
    }

    Object.setPrototypeOf(obj, new Proxy(obj, {
        get(target: object, p: string | symbol, receiver: any): any {
            throwInvalid();
        },
        set(target: object, p: string | symbol, newValue: any, receiver: any): boolean {
            throwInvalid()
            return false;
        },
        defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
            throwInvalid();
            return false;
        },
        deleteProperty(target: object, p: string | symbol): boolean {
            throwInvalid()
            return false;
        },
        ownKeys(target: object): ArrayLike<string | symbol> {
            throwInvalid()
            return [];
        }
    }))
}

/**
 * @returns the real real origial object from the real world
 */
export function getGlobalOrig<T extends object>(obj: T): T {
    let handler: FacadeProxyHandler<any> | undefined
    while((handler = proxyToProxyHandler.get(obj)) !== undefined) {
        obj = handler.target as T;
    }
    return obj;
}

export abstract class RecordedReadOnProxiedObject extends RecordedRead {
    proxyHandler!: WatchedProxyHandler
    /**
     * A bit redundant with proxyhandler. But for performance reasons, we leave it
     */
    origObj!: object;

    get proxy() {
        return this.proxyHandler.proxy
    }
}

export interface IWatchedProxyHandler_common {
    /**
     * Registers the Read to this WatchedProxyHandler and fires it on the WatchedFacade (informs WatchedFacade's listeners)
     * @param read
     */
    fireAfterRead(read: RecordedReadOnProxiedObject): void;

    getFacade(): ProxyFacade<any>
}

/**
 * For use in proxy and direct
 */
export interface DualUseTracker<T> {

    /**
     * Will return the handler when called through the handler
     */
    get _watchedProxyHandler(): IWatchedProxyHandler_common | undefined;

    /**
     * The original (unproxied) object
     */
    get _target(): T
}

//@ts-ignore
export function dualUseTracker_callOrigMethodOnTarget<O extends object, M extends keyof O>(tracker: DualUseTracker<O>, methodName: M, args: unknown[]): ReturnType<O[M]> {
    const target = tracker._target;
    const method = tracker._watchedProxyHandler !== undefined ? target[methodName] : Object.getPrototypeOf(Object.getPrototypeOf(tracker))[methodName];
    return method.apply(target, args);
}

/**
 * Used by runChangeOperation
 */
class ChangeCall {
    fired_beforeListeners = new Set<ChangeListener>();
    afterListeners = new Set<ChangeListener>();

    /**
     * "binds" the ChangeOperation parameter to the afterListeners
     */
    paramsForAfterListeners = new Map<ChangeListener, ChangeOperation>();
}

const runChangeOperation_Calls = newDefaultMap<object, ChangeCall>(() => new ChangeCall());

/**
 * Informs hooksToServe's beforeListeners + executes changeOperation + informs hooksToServe's afterListeners.
 * All this while preventing listeners from beeing called twice (this is the main purpose of this function!). Even during the same operation (call) that spans a call stack (the stack can go through multiple proxy layers)
 * <p>
 *     This function is needed, because there's some overlapping of concerns in listener types, especially for Arrays. Also internal methods may again call the set method which itsself wants to call the propertychange_listeners.
 * </p>
 * @param forTarget object to sync on. All hooks passed to nested runChangeOperation calls will only be fired once.
 * @param paramForListeners the parameter for the change listeners. It won't be run by this function / it's just the parameter. When setting to undefined, it indicates that this runChangeOperation call is only to wrap multiple nested calls / sync them on targetObject. The default anyChange hook won't be called at this level either.
 * @param hooksToServe these hooks will be called (not twice, as mentioned).
 * @param changeOperationFn
 */
export function runChangeOperation<R>(forTarget: object, paramForListeners: ChangeOperation | undefined, hooksToServe: EventHook[], changeOperationFn: () => R): R {
    const synchronizeOn = getGlobalOrig(forTarget);
    let isRootCall = !runChangeOperation_Calls.has(synchronizeOn); // is it not nested / the outermost call ?
    const changeCall = runChangeOperation_Calls.get(synchronizeOn);
    try {
        if (paramForListeners) {
            hooksToServe.push(getChangeHooksForObject(forTarget).anyChange); // Always serve this one as well
            objectMembershipInGraphs.get(forTarget)?.forEach(graph => {
                hooksToServe.push(graph._changeHook);
            })

            // Fire and register before-hooks:
            hooksToServe.forEach(hook => {
                hook.beforeListeners.forEach(listener => {
                    if (!changeCall.fired_beforeListeners.has(listener)) {
                        listener(paramForListeners); // fire
                        changeCall.fired_beforeListeners.add(listener);
                    }
                })

                hook.afterListeners.forEach(afterListener => {
                    if (!changeCall.afterListeners.has(afterListener)) {
                        changeCall.afterListeners.add(afterListener);
                        changeCall.paramsForAfterListeners.set(afterListener, paramForListeners); // Ensure, it is called with the proper changeOperation parameter afterwards. Otherwise stuff from a higher level facade would leak to a change listeners, registered in a lower facade
                    }
                }); // schedule afterListeners
            });
        }

        const result = changeOperationFn();

        if (isRootCall) {
            // call afterListeners:
            for (const listener of changeCall.afterListeners) {
                listener(changeCall.paramsForAfterListeners.get(listener)!); // fire
            }
        }

        return result;
    } finally {
        if (isRootCall) {
            runChangeOperation_Calls.delete(synchronizeOn);
        }
    }
}

export interface ForWatchedProxyHandler<T> extends DualUseTracker<T> {
    /**
     * Will return the handler when called through the handler
     */
    get _watchedProxyHandler(): IWatchedProxyHandler_common;

    /**
     * The original (unproxied) object
     */
    get _target(): T
}

/**
 * Use this to delete properties on objects that have a write tracker installed. Otherwise they are not deletable and the write tracker cannot track the object's keys modification and inform listeners
 * @param obj
 * @param key
 */
export function deleteProperty<O extends object>(obj: O, key: keyof O) {
    if(!changeTrackedOrigObjects.hasObj(obj)) {
        return delete obj[key];
    }

    const doesExist = Object.getOwnPropertyDescriptor(obj, key) !== undefined;
    if (!doesExist) {
        return true;
    }

    return runChangeOperation(obj, new UnspecificObjectChange(obj), [getChangeHooksForObject(obj).changeOwnKeys], () => {
        //@ts-ignore
        obj[key] = undefined; // Set to undefined first, so property change listeners will get informed
        return delete obj[key];
    });
}

export class GetterCall {
    proxy: object;
    key: ObjKey;

    constructor(proxy: object, key: ObjKey) {
        this.proxy = proxy;
        this.key = key;
    }
}

export const changeTrackedOrigObjects = new PartialGraph();