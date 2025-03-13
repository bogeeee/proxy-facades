import {ClassTrackingConfiguration, Clazz, ForWatchedProxyHandler} from "../common";
import {WatchedProxyHandler} from "../watchedProxyFacade";
import _ from "underscore";


export class IteratorReadTracker<T> extends Iterator<T> implements ForWatchedProxyHandler<Iterator<T>> {
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
        const result = this._target.next(...args as any);
        return new IteratorResultWrapper(result);
    }
}

/**
 * Wrapper, to make this a class, so there can be a special behaviour configured for it
 */
class IteratorResultWrapper<T> {
    done!: false | true;
    value!: any;
    constructor(orig: IteratorResult<T>) {
        _.extend(this, orig);
    }
}

export const IteratorConfig = new class extends ClassTrackingConfiguration {
    clazz=Iterator as any as Clazz;
    worksForSubclasses=true;
    readTracker= IteratorReadTracker;
    changeTracker = undefined;
    receiverMustBeNonProxied = true;
    /**
     * The Array/Set/Map's [Symbol.Iterator] methods already fires a read of **all** values (simply stupid). So the Iterator/IteratorResult does not need to fire any more. The tests also don't expect this to fire.
     * Still could be enabled in the future for really fine granular behaviour tracking
     */
    trackTreads = false;
}

export const IteratorResultWrapperConfig = new class extends ClassTrackingConfiguration {
    clazz=IteratorResultWrapper as any as Clazz;
    worksForSubclasses=false;
    /**
     * The Array/Set/Map's [Symbol.Iterator] methods already fires a read of **all** values (simply stupid). So the Iterator/IteratorResult does not need to fire any more. The tests also don't expect this to fire.
     * Still could be enabled in the future for really fine granular behaviour tracking
     */
    trackTreads = false;
}