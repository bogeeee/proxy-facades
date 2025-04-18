import {arraysAreEqualsByPredicateFn, read, throwError, WeakMapSet} from "./Util";

export type ObjKey = string | symbol;

export abstract class RecordedRead {
    abstract equals(other: RecordedRead): boolean;

    abstract get isChanged(): boolean;

    /**
     *
     * @param listener
     * @param trackOriginal true to install a tracker on the non-proxied- (by this facade) original object
     */
    abstract onAfterChange(listener: () => void, trackOriginal?: boolean): void;

    abstract offAfterChange(listener: () => void): void;
}

export type AfterReadListener = (read: RecordedRead) => void;

export type Clazz = {
    new(...args: any[]): unknown
}

export type GetIteratorValueProxiedFn<T> = (value: T) => T;
export type IteratorReturningProxiedValue<T> = Iterator<T> & {_getValueProxied: GetIteratorValueProxiedFn<T>}

/**
 * A change operation that may later be serializable. Beeing able to store it in the transaction protocol of membrace-db. Or to syncronize live objects between server->client
 */
export abstract class ChangeOperation {

    /**
     * Saved inputs as arguments for the do function
     */
    inputs?: Parameters<this["_do"]>

    abstract _do(...inputs: unknown[]): {result: unknown, undoInfo: unknown}

    _unDo(undoInfo: ReturnType<this["_do"]>["undoInfo"]): void {
        throw new Error("Not yet implemented")
    }

    constructor() {
        // Check if registered:
        changeOperationsClasses.has(this.constructor.name) || throwError("Change operation was not registered. Please register the class first, with registerChangeOperationClass(...)");
    }

    withInputs(...inputs: Parameters<this["_do"]>): this {
        this.inputs = inputs;
        return this;
    }

    do(): ReturnType<this["_do"]>["undoInfo"] {
        if(this.inputs === undefined) throw new Error("inputs not set");

        return this._do(...this.inputs).result;
    }
}

const changeOperationsClasses = new Map<string, typeof ChangeOperation>();
export function registerChangeOperationClass(clazz: typeof ChangeOperation) {
    const name = clazz.name as string;
    name || throwError("Change operation class does not have a name. Is it an anonymous class?")
    !(changeOperationsClasses.has(name) && changeOperationsClasses.get(name) !== clazz) || throwError("Another change operation class is already registered under the name: " + name);
    changeOperationsClasses.set(name, clazz);
}



export type ChangeListener = (change: ChangeOperation) => void;

/**
 * Registry for one possible potential target event type. I.e. a property of a certain object, or a more abstract one like: "some key of a certain object has changed".
 */
export class EventHook {
    /**
     * Called before the change
     * @param change
     */
    beforeListeners =  new Set<ChangeListener>();

    /**
     * Called after the change
     * @param change
     */
    afterListeners= new Set<ChangeListener>();

    /**
     * To be able to easily control the before and after for exactly the same change. It's an idea / no good use case found yet.
     * @param change
     * @param doChange
     */
    //interceptors = new Set<(change: RecordedChange, doChange: () => void) => void>();

    fireBefore(change: ChangeOperation) {
        this.beforeListeners.forEach(l => l(change));
    }

    fireAfter(change: ChangeOperation) {
        this.afterListeners.forEach(l => l(change));
    }
}


/**
 * Like Object.getOwnPropertyDescriptor. But for all parent classes
 * @param o
 * @param p
 */
export function getPropertyDescriptor(o: object, p: PropertyKey):  PropertyDescriptor | undefined {
    let result = Object.getOwnPropertyDescriptor(o, p);
    if(result !== undefined) {
        return result;
    }
    let proto = Object.getPrototypeOf(o);
    if(proto !== null) {
        return getPropertyDescriptor(proto, p);
    }
}

export type GetterFlags = {
    origHadGetter?: boolean
}
export type SetterFlags = {
    origHadSetter?: boolean
}

const runAndCallListenersOnce_after_listeners = new Map<object, Set<() => void>>();


let esRuntimeBehaviourAlreadyChecked = false;
export function checkEsRuntimeBehaviour() {
    if(esRuntimeBehaviourAlreadyChecked) {
        return;
    }
    // **************************************************************************************************
    // **** The following code is generated via `npm run dev:generateEsRuntimeBehaviourCheckerCode`: ****
    // **************************************************************************************************
    //@ts-ignore
    expectUsingMethodsOrFields(["a"], v=>v.at(0), ["at","length","0"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.concat("d","e","f"), ["concat","constructor",Symbol.isConcatSpreadable,"length","0","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.map(x=>read(x)), ["map","length","constructor","0","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.forEach(x=>read(x)), ["forEach","length","0","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.join(","), ["join","length","0","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c","d"], v=>v.slice(1,3), ["slice","length","constructor","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.some(x=>x==="a"), ["some","length","0"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.filter(x=>x==="a"), ["filter","length","constructor","0","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.find(x=>x==="a"), ["find","length","0"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.every(x=>x==="a"), ["every","length","0","1"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.findIndex(x=>x==="a"), ["findIndex","length","0"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.includes("b",1), ["includes","length","1"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.indexOf("b",1), ["indexOf","length","1"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v[Symbol.iterator]().next(), [Symbol.iterator,"length","0"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","b"], v=>v.lastIndexOf("b",1), ["lastIndexOf","length","1"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","b"], v=>v.reduce((p,c)=>p+c), ["reduce","length","0","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","b"], v=>v.reduceRight((p,c)=>p+c), ["reduceRight","length","2","1","0"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","b"], v=>v.toLocaleString(), ["toLocaleString","length","0","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","b"], v=>v.toString(), ["toString","join","length","0","1","2"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c"], v=>v.unshift("_a","_b"), ["length","2","1","0"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c","d"], v=>v.splice(1,2,"newB","newC","newX"), ["length","1","2","3"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c","d"], v=>v.copyWithin(3,1,3), ["length","1","0","2","3"])
    //@ts-ignore
    expectUsingMethodsOrFields(["a","b","c","d"], v=>v.reverse(), ["length","0","3","1","2"])
    //@ts-ignore
    if([].values().forEach) { // Runtime supports these iterator functions like forEach, filter, ....
        //@ts-ignore
        expectUsingMethodsOrFields(["a","b","c"][Symbol.iterator](), it=>it.forEach(x=>x), ["forEach","next"])
        //@ts-ignore
        expectUsingMethodsOrFields(["a","b","c"][Symbol.iterator](), it=>it.filter(x=>x==="b"), ["filter","next"])
        //@ts-ignore
        expectUsingMethodsOrFields(["a","b","c"][Symbol.iterator](), it=>it.take(2), ["take","next"])
        //@ts-ignore
        expectUsingMethodsOrFields(["a","b","c"][Symbol.iterator](), it=>it.toArray(), ["toArray","next"])
    }




    // **************************************************************************************************
    // **************************************************************************************************
    // **************************************************************************************************

    function expectUsingMethodsOrFields<T extends object>(orig: T, tester: (orig: T) => void,  expectedMethodsOrFields: Array<string | symbol> ) {
        // Run the tester and record used methods/fields:
        const usedMethodsOrFields = new Set<string | symbol>();
        const proxy = new Proxy(orig, {
            get(target: T, p: string | symbol, receiver: any): any {
                usedMethodsOrFields.add(p)
                if(p === "next") {
                    //@ts-ignore
                    return (...args: unknown[]) => target.next(...args); // .next() method must run on target, not on proxy
                }
                //@ts-ignore
                return target[p];
            }
        })
        read(tester(proxy));

        !expectedMethodsOrFields.some(mf => mf !== "constructor" && !usedMethodsOrFields.has(mf)) || throwError(new Error(`The javascript runtime is not behaving as expected. Please report this as a bug along with your javascript runtime (or Browser) version`))
    }
    esRuntimeBehaviourAlreadyChecked = true;
}

/**
 * Configures tracking behaviour for a certain class
 */
export abstract class ClassTrackingConfiguration {
    /**
     * For which is this config?
     */
    abstract clazz: Clazz // TODO: Minor: better type than Clazz.

    worksForSubclasses = false;

    readTracker?: Clazz;
    changeTracker?: Clazz;
    /**
     * Built-in Methods, which are using fields / calling methods on the proxy transparently/loyally, so those methods don't call/use internal stuff directly.
     * Tested with, see dev_generateEsRuntimeBehaviourCheckerCode.ts
     * May include read-only / reader methods
     */
    knownHighLevelMethods = new Set<ObjKey>();
    /**
     * Non-high level. These fire `RecordedUnspecificRead`s then. So better implement them instead to fire i.e RecordedArrayValuesRead.
     */
    readOnlyMethods = new  Set<ObjKey>();

    /**
     * Non-high level. Same as above: better implement them
     */
    readOnlyFields = new Set<ObjKey>();

    /**
     * Default, if not listed as high-level method
     */
    receiverMustBeNonProxied=true;

    /**
     * Makes the WatchedProxyFacade's handler also track/fire reads for methods that are not **directly** in the this.readTracker class.
     */
    trackTreads=true;

    /**
     * (For Array:) Flags to track setting properties, meaning changes are not only done by calling methods. This will use a Proxy (install a Proxy as Prototype).
     */
    trackSettingObjectProperties=false;

    /**
     * Wrap the results of methods which are not in the readTracker or changeTracker in proxies
     * Take caution when enabling this. It is not always a good idea. I.e. Map#entries() return new intermediates arrays [] and these will then also be proxied and result in a false positive something-has-changed detection when comparing recorded Reads.
     */
    proxyUnhandledMethodResults=false

    /**
     * Lists read and changeTracker as far as they're present
     */
    getTrackerClasses(): Clazz[] {
        const result = [];
        if(this.readTracker !== undefined) {
            result.push(this.readTracker);
        }
        if(this.changeTracker !== undefined) {
            result.push(this.changeTracker);
        }
        return result;
    }
}

export function recordedReadsArraysAreEqual(a: RecordedRead[], b: RecordedRead[]) {
    return arraysAreEqualsByPredicateFn(a, b, (a, b) => a.equals(b));
}

/**
 * Patches the iterator so it runs the value through the translateFn
 * @param iterator
 * @param translateFn
 */
export function makeIteratorTranslateValue<V, IT extends Iterator<V>>(iterator: IT, translateFn: (value: V) => V): IT {
    const originalNext = iterator.next;

    function next(this: Iterator<V>, ...args: unknown[]): ReturnType<Iterator<V>["next"]> {
        const result = originalNext.apply(this, args as [any]);
        if(!result.done) {
            result.value = translateFn(result.value);
        }
        return result;
    }
    iterator.next = next; // Patch iterator
    return iterator;
}


/**
 * Base for ProxyFacades and change-tracking of original objects (without proxy facades) See {@see changeTrackedOriginaObjects the changeTrackedOriginaObjects global instance}
 */
export class PartialGraph {
    /**
     * True means, it spreads it's self when members are read or set. Not yet implemented for non-proxy-facades.
     * Always true for proxy-facade subclasses (that's their job).
     */
    viral = false;

    /**
     * Called after a change has been made to any object inside this graph
     * Note: There are also listeners for specified properties/situations (which are more capable)
     * @protected
     */
    _changeHook = new EventHook()

    /**
     *
     * @param listener Called when a change is made to any object inside this graph.
     * The listener is called when the change is not yet written unlike {@see onAfterChange}. So throwing an exception in the listener will prevent the actual change from happening.
     */
    onBeforeChange(listener: ChangeListener) {
        this._changeHook.beforeListeners.add(listener);
    }

    /**
     * Unregister listener from {@see PartialGraph#onBeforeChange}
     * @param listener
     */
    offBeforeChange(listener: ChangeListener) {
        this._changeHook.beforeListeners.delete(listener);
    }
    
    /**
     *
     * @param listener Called after a change has been made to any object inside this graph
     */
    onAfterChange(listener: ChangeListener) {
        this._changeHook.afterListeners.add(listener);
    }

    /**
     * Unregister listener from {@see PartialGraph#onAfterChange}
     * @param listener
     */
    offAfterChange(listener: ChangeListener) {
        this._changeHook.afterListeners.delete(listener);
    }

    hasObj(obj: object) {
        return objectMembershipInGraphs.get(obj)?.has(this);
    }

    _register(obj: object) {
        objectMembershipInGraphs.add(obj, this);
    }
}

export const objectMembershipInGraphs = new WeakMapSet<object, PartialGraph>();

/**
 * TODO: Implement subclasses
 */
export class UnspecificObjectChange extends ChangeOperation {
    constructor(target?: object) {
        super();
        if (target !== undefined) {
            //@ts-ignore
            this.inputs = [target, /* state of target AFTER the opertation*/];
        }
    }

    _do(...inputs: unknown[]) {
        // TODO: restore state after
        return {result: undefined, undoInfo: undefined};
    }

    _unDo(undoInfo: ReturnType<this["_do"]>["undoInfo"]): void {
        throw new Error("Not yet implemented");
    }
}
registerChangeOperationClass(UnspecificObjectChange);