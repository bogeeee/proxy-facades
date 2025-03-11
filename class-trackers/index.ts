import {ClassTrackingConfiguration, Clazz} from "../common";
import {config as arrayConfig} from "./array"
import {config as setConfig} from "./set"
import {config as mapConfig} from "./map"

/**
 * Register configurations here:
 */
export const classTrackingConfigurations = new Map<Clazz, ClassTrackingConfiguration>([
    [Array,arrayConfig],
    [Set,setConfig],
    [Map,mapConfig],
]);

export function getTrackingConfigFor(obj: object): ClassTrackingConfiguration | undefined {
    const clazz = obj.constructor as Clazz;
    if(clazz === undefined) {
        return undefined;
    }
    return classTrackingConfigurations.get(clazz);
}