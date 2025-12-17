/**
 * Listeners for one object
 */
import {newDefaultMap, throwError} from "./Util";
import {
    ClassTrackingConfiguration,
    EventHook,
    getPropertyDescriptor,
    GetterFlags,
    ObjKey,
    SetterFlags,
    UnspecificObjectChange,
} from "./common";
import {runChangeOperation} from "./proxyFacade";

/**
 * Contains change listeners for one specific object.
 * Note for specificity: There will be only one of the **change** events fired. The Recorded...Read.onChange handler will add the listeners to all possible candidates. It's this way around.
 * Does not apply to setterInvoke.. These are fired in addition (not thought through for all situations)
 */
class ObjectChangeHooks {
    /**
     * For writes on **setters** (also if these are the same/unchanged values)
     */
    setterInvoke = newDefaultMap<ObjKey, EventHook>( () => new EventHook());
    changeSpecificProperty = newDefaultMap<ObjKey, EventHook>( () => new EventHook());
    changeAnyProperty = new EventHook();

    /**
     * Means, the result of Object.keys will be different after the change. All iterations over the object/arrays's keys or values are informed that there was a change. Individual {@link changeSpecificProperty} are not affected!
     */
    changeOwnKeys = new EventHook();
    /**
     * These will always be called, no matter how specific a change is
     */
    anyChange = new EventHook();

    /**
     *
     */
    unspecificChange = new EventHook();
}



export const changeHooksForObject = new WeakMap<object, ObjectChangeHooks>();
export function getChangeHooksForObject(obj: object) {
    let result = changeHooksForObject.get(obj);
    if(result === undefined) {
        changeHooksForObject.set(obj, result = new ObjectChangeHooks());
    }
    return result;
}

export class ObjectProxyHandler implements ProxyHandler<object> {
    target: object;
    origPrototype: object | null;
    proxy: object;
    trackingConfig?: ClassTrackingConfiguration

    constructor(target: object, trackingConfig: ClassTrackingConfiguration | undefined) {
        this.target = target;
        this.trackingConfig = trackingConfig;
        this.origPrototype = Object.getPrototypeOf(target);


        Object.getOwnPropertyNames(target).forEach(key => {
            if(key === "length" && Array.isArray(target)) {
                return; // Leave the length property as is. It won't be set directly anyway
            }
            this.installSetterTrap(key)
        });

        // Create proxy:
        //const targetForProxy = {}; // The virtual way
        const targetForProxy=target // Preserves Object.keys and instanceof behaviour :), iterators and other stuff. But the downside with this is, that it does not allow to proxy read only properties
        this.proxy = new Proxy(targetForProxy, this);
    }

    installSetterTrap(key: ObjKey) {
        let target = this.target;
        let origDescriptor = getPropertyDescriptor(target, key);

        // Retrieve current:
        let current:  {isErrored: false, value: unknown} | {/* Note: isErrored is currently useless, cause proxy-facades treats accessors as white-box */ isErrored: true} = (()=> {
            try {
                //@ts-ignore
                return {isErrored: false, value: origDescriptor?.value /* performance */ || target[key]};
            }
            catch (e) {
                return {isErrored: true} as any
            }
        })();

        const origSetter = origDescriptor?.set;
        const origGetter = origDescriptor?.get;

        let origOwnDescriptor = Object.getOwnPropertyDescriptor(target, key);
        if(origOwnDescriptor !== undefined) {
            if(origOwnDescriptor.configurable !== true) {
                throw new Error("Cannot delete non- 'configurable' property:" + String(key));
            }
            //@ts-ignore
            delete target[key]; // delete the old, or the following Object.defineProperty will conflict
        }

        function newSetter(this:any, newValue: unknown) {
            const changeHooksForTarget = getChangeHooksForObject(target);

            if(origSetter !== undefined) {
                runChangeOperation(target, new UnspecificObjectChange(target),[changeHooksForTarget.setterInvoke.get(key)],() => {
                    origSetter.apply(this, [newValue]);  // call the setter
                });
                return;
            }

            if(origGetter !== undefined) {
                // call the getter. Is this a good idea to refresh the value here?
                try {
                    current = {isErrored: false, value: origGetter.apply(target)};
                }
                catch (e) {
                    current = {isErrored: true};
                    throw e;
                }
                throw new TypeError("Target originally had a getter and no setter but the property is set.");
            }

            //@ts-ignore
            if (current.isErrored || newValue !== current.value) { // modify ?
                // run change operation and call listeners:
                const hooksToServe: EventHook[] = [];
                if(Array.isArray(target)) {
                    hooksToServe.push(changeHooksForTarget.unspecificChange);
                }
                hooksToServe.push(changeHooksForTarget.changeSpecificProperty.get(key))
                hooksToServe.push(changeHooksForTarget.changeAnyProperty)
                runChangeOperation(target, new UnspecificObjectChange(target),hooksToServe,() => {
                    //@ts-ignore
                    current = {isErrored: false, value: newValue};
                });
            }

        }
        (newSetter as SetterFlags).origHadSetter = origSetter !== undefined;

        function newGetter(this: any) {
            if(origGetter !== undefined) {
                // Retrieve value from getter:
                try {
                    current = {isErrored: false, value: origGetter.apply(this)};  // call the getter
                }
                catch (e) {
                    current = {isErrored: true}
                    throw e;
                }
            }
            if(current.isErrored) throw new Error("Illegal state");
            return current.value;
        }
        (newGetter as GetterFlags).origHadGetter = origGetter !== undefined;

        Object.defineProperty( target, key, { // TODO: [Performance optimization tipps, see js example](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty#description)
            set: newSetter,
            get: newGetter,
            enumerable: origOwnDescriptor !== undefined?origOwnDescriptor?.enumerable:true,
            configurable: true, // Allow to delete the property. Note that you should use the {@link deleteProperty} function
        })
    }

    protected withUnspecificChange<R>(changeFn: () => R): R {
        return runChangeOperation(this.target, new UnspecificObjectChange(this.target), [getChangeHooksForObject(this.target).unspecificChange], changeFn)
    }

    get(fake_target:object, key: ObjKey, receiver:any): any {
        // Validity check
        const target = this.target;

        if(receiver !== target) {
            throw new Error("Invalid state. Get was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
        }

        // Check for and use change tracker class:
        const changeTrackerClass = this.trackingConfig?.changeTracker
        if (changeTrackerClass !== undefined) {
            let propOnSupervisor = Object.getOwnPropertyDescriptor(changeTrackerClass.prototype, key);
            if (propOnSupervisor !== undefined) { // Supervisor class is responsible for the property (or method) ?
                //@ts-ignore
                if (propOnSupervisor.get) { // Prop is a getter?
                    return propOnSupervisor.get.apply(target)
                } else if (propOnSupervisor.value) { // Prop is a value, meaning a function. (Supervisors don't have fields)
                    return changeTrackerClass.prototype[key];
                }
            }
            else {
                const origValue = changeTrackerClass.prototype[key]
                if(typeof origValue === "function") {
                    origMethod = origValue;
                    if (this.trackingConfig?.knownHighLevelMethods.has(key)) {
                        return trapForHighLevelWriterMethod
                    } else if (!this.trackingConfig?.readOnlyMethods.has(key) && !(key as any in Object.prototype)) { // Read-write method that was not handled directly by change tracker class?
                        return trapForGenericWriterMethod // Assume the worst, that it is a writer method
                    }
                }
            }
        }

        // return this.target[key]; // This line does not work because it does not consult ObjectProxyHandler#getPrototypeOf and therefore uses the actual tinkered prototype chain which has this proxy in there and calls get (endless recursion)
        const propDesc = getPropertyDescriptor(target, key)
        if (propDesc !== undefined) {
            let result: unknown;
            let getter = propDesc.get;
            if (getter !== undefined) {
                result = getter.apply(target);
            }
            else {
                result = propDesc.value;
            }
            return result;
        }

        var origMethod: ((this:unknown, ...args:unknown[]) => unknown) | undefined = undefined;
       /**
         * Calls the unspecificChange listeners
         * @param args
         */
        function trapForGenericWriterMethod(this:object, ...args: unknown[]) {
            if(this !== receiver) {
                //throw new Error("Invalid state. Method was called on invalid target")
            }
           return runChangeOperation(target, new UnspecificObjectChange(target),[getChangeHooksForObject(target as Array<unknown>).unspecificChange],() => {
                return origMethod!.apply(this, args);  // call original method
            });
        }

        /**
         * Wraps it in runAndCallListenersOnce_after
         * @param args
         */
        function trapForHighLevelWriterMethod(this:object, ...args: unknown[]) {
            if(this !== receiver) {
                //throw new Error("Invalid state. Method was called on invalid target")
            }
            return runChangeOperation(target, undefined,[],() => {
                return origMethod!.apply(this, args);  // call original method
            });
        }
    }

    set(fake_target:object, key: ObjKey, value:any, receiver:any) {
        // Validity check
        if(receiver !== this.target) {
            throw new Error("Invalid state. Set was called on a different object than this write-tracker-proxy (which is set as the prototype) is for. Did you clone the object, resulting in shared prototypes?")
        }

        runChangeOperation(this.target, new UnspecificObjectChange(this.target),[getChangeHooksForObject(this.target).changeOwnKeys],() => { // There was no setter trap yet. This means that the key is new. Inform those listeners:

            // if this "set" method got called, there is no setter trap installed yet
            this.installSetterTrap(key);

            //@ts-ignore
            this.target[key] = value; // Set value again. this should call the setter trap
        });

        return true;
    }

    getPrototypeOf(target: object): object | null {
        return this.origPrototype;
    }

    defineProperty(target: object, property: string | symbol, attributes: PropertyDescriptor): boolean {
        throw new Error("Defineproperty not yet supported");
    }

}
