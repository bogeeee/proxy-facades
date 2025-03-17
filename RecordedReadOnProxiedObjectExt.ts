import {AfterWriteListener, RecordedReadOnProxiedObject} from "./common";
import {installChangeTracker} from "./origChangeTracking";
import {isProxyForAFacade} from "./proxyFacade";


/**
 * Offers a more convenient method: getAffectingChangeListenerSets
 */
export abstract class RecordedReadOnProxiedObjectExt extends RecordedReadOnProxiedObject {

    onChange(listener: () => void, trackOriginal = false) {
        this.getAffectingChangeListenerSets(this.proxyHandler.proxy).forEach(listenerSet => listenerSet?.add(listener));
        if (trackOriginal) {
            if(!isProxyForAFacade(this.obj)) {
                installChangeTracker(this.obj);
            }
            this.getAffectingChangeListenerSets(this.obj).forEach(listenerSet => listenerSet?.add(listener));
        }
    }

    offChange(listener: () => void) {
        this.getAffectingChangeListenerSets(this.obj).forEach(listenerSet => listenerSet?.delete(listener));
        this.getAffectingChangeListenerSets(this.proxyHandler.proxy).forEach(listenerSet => listenerSet?.delete(listener));
    }

    /**
     *
     * @param target The target for which... This method might be called for multiple targets from different watchedproxyfacade layers or at last layer for the original unproxied object
     * @returns the sets where to add/remove listeners by the onChange/offChange methods
     */
    getAffectingChangeListenerSets(target: object): (Set<AfterWriteListener>|undefined)[] {
        throw new Error("TODO")
    }
}