import {ClassTrackingConfiguration, Clazz} from "../common";
import {config as arrayConfig} from "./array"
import {config as setConfig} from "./set"
import {config as mapConfig} from "./map"
import {classIsSubclassOf, throwError} from "../Util";

/**
 * Register configurations here:
 */
export const classTrackingConfigurations: ClassTrackingConfiguration[] = [arrayConfig, setConfig, mapConfig];

const cache_clazzToConfig = new WeakMap<Clazz, ClassTrackingConfiguration | undefined>();

export function getTrackingConfigFor(obj: object): ClassTrackingConfiguration | undefined {
    const clazz = obj.constructor as Clazz;
    if(clazz === undefined) {
        return undefined;
    }

    if(cache_clazzToConfig.has(clazz)) {
        return cache_clazzToConfig.get(clazz);
    }
    const result = classTrackingConfigurations.find(cfg=> {
        if(cfg.clazz === clazz) {
            return true;
        }

        if(classIsSubclassOf(clazz, cfg.clazz)) {
            cfg.worksForSubclasses || throwError(`Subclasses of ${cfg.clazz.name} are not supported. Actually got: ${clazz.name}`);
            return true;
        }

        return false;
    });
    cache_clazzToConfig.set(clazz, result);
    return result;
}