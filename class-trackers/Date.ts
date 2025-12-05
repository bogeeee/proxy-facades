import {ClassTrackingConfiguration} from "../common";

export const config = new class extends ClassTrackingConfiguration {
    clazz= Date;


    /**
     *
     */
    receiverMustBeNonProxied = true;

    trackSettingObjectProperties = false;
}