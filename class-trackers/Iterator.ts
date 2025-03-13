import {ClassTrackingConfiguration, Clazz, ForWatchedProxyHandler, GetIteratorValueProxiedFn} from "../common";
import {WatchedProxyHandler} from "../watchedProxyFacade";
import _ from "underscore";
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// ******** THIS FILE IS NOT USED !!!!!! *********
// ***********************************************
// Currently we use a much simpler way to translate the iteration values to proxies, see common.ts/makeIteratorTranslateValue
// Still we leave this file, cause may be in the future there will be super fine per-iteration read tracking
// ---------------------------------------------------------------------------------------------------------
// Supplying a proxy with ReadTracker for to
// - easily handle all kinds of Subclasses (Array/Set/Map-Iterator)
// - easily allow high-level methods like forEach, filter, ... This would be difficult when subclassing these
//
// TO make it work:
//inside class ArrayReadTacker {
//    values(): ArrayIterator<T> {
//        const result = this._target.values();
//        this._fireAfterValuesRead();
//        result._getValueProxied = (value) => this._watchedProxyHandler.getFacade().getProxyFor(value)
//        return this._watchedProxyHandler.getFacade().getProxyFor(result); // Wrap in proxy. There's special handling for proxied iterators to return the iteration value proxied.
//  }
//}
export class IteratorReadTracker<T> extends Iterator<T> implements ForWatchedProxyHandler<Iterator<T>> {
    /**
     * This field should be set by the method that returns the Iterator. I.e. Array#values
     */
    _getValueProxied?: GetIteratorValueProxiedFn<T>;

    get _watchedProxyHandler(): WatchedProxyHandler {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the handler when called through the handler
    }

    get _target(): Iterator<T> {
        throw new Error("not calling from inside a WatchedProxyHandler"); // Will return the value when called through the handler
    }

    constructor() {
        super();
    }

    /**
     * Pretend that this is an Iterator
     */
    get ["constructor"]() {
        return Iterator; // TODO: subclass
    }

    next(...args: unknown[]): IteratorResult<T, any> {
        const {value, done} = this._target.next(...args as any);
        //@ts-ignore
        return {
            value: this._watchedProxyHandler.getFacade().getProxyFor(value),
            done
        }
    }
}

export const IteratorConfig = new class extends ClassTrackingConfiguration {
    clazz=Iterator as any as Clazz;
    worksForSubclasses=true;
    readTracker= IteratorReadTracker;
    changeTracker = undefined;
    /**
     * The methods, not implemented in readTracker, are high-level
     */
    receiverMustBeNonProxied = false;
    /**
     * The Array/Set/Map's [Symbol.Iterator]/keys/values methods already fires a read of **all** values (simply stupid). So the Iterator/IteratorResult does not need to fire any more. The tests also don't expect this to fire.
     * Still could be enabled in the future for really fine granular behaviour tracking
     */
    trackTreads = false;
    proxyUnhandledMethodResults = false;
}