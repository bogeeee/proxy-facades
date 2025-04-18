import {ChangeListener, EventHook} from "./common";
import {installChangeTracker} from "./origChangeTracking";
import {isProxyForAFacade, RecordedReadOnProxiedObject} from "./proxyFacade";


/**
 * Offers a more convenient method: getAffectingChangeHooks
 */
export abstract class RecordedReadOnProxiedObjectExt extends RecordedReadOnProxiedObject {

    /**
     * @param listener
     * @param trackOriginal
     */
    onAfterChange(listener: () => void, trackOriginal = false) {
        this.getAffectingChangeHooks(this.proxyHandler.proxy).forEach(eventHook => eventHook.afterListeners.add(listener));
        if (trackOriginal) {
            if(!isProxyForAFacade(this.origObj)) {
                installChangeTracker(this.origObj);
            }
            this.getAffectingChangeHooks(this.origObj).forEach(eventHook => eventHook.afterListeners.add(listener));
        }
    }

    /**
     *
     */
    offAfterChange(listener: () => void) {
        this.getAffectingChangeHooks(this.origObj).forEach(eventHook => eventHook.afterListeners.delete(listener));
        this.getAffectingChangeHooks(this.proxyHandler.proxy).forEach(eventHook => eventHook.afterListeners.delete(listener));
    }

    /**
     *
     * @param target The target for which... This method might be called for multiple targets from different watchedproxyfacade layers or at last layer for the original unproxied object
     * @returns the sets where to add/remove listeners by the onChange/offChange methods
     */
    getAffectingChangeHooks(target: object): EventHook[] {
        throw new Error("TODO")
    }
}