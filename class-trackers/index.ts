import {ClassTrackingConfiguration, Clazz} from "../common";
import {config as arrayConfig} from "./Array"
import {config as setConfig} from "./Set"
import {config as mapConfig} from "./Map"
import {IteratorConfig} from "./Iterator"
import {classIsSubclassOf, throwError} from "../Util";

/**
 * Register configurations here:
 */
export const classTrackingConfigurations: ClassTrackingConfiguration[] = [arrayConfig, setConfig, mapConfig, IteratorConfig];

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