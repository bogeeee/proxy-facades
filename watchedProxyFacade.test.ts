import {it, expect, test, beforeEach,describe, vitest, vi} from 'vitest'
import {
    RecordedPropertyRead,
    WatchedProxyFacade
} from "./watchedProxyFacade";
import _ from "underscore"
import {arraysAreEqualsByPredicateFn, isObject, read, visitReplace} from "./Util";
import {Clazz, ObjKey, RecordedRead, recordedReadsArraysAreEqual} from "./common";
import {installChangeTracker} from "./origChangeTracking";
import {changeTrackedOrigObjects, ProxyFacade, deleteProperty} from "./proxyFacade";
import exp from "constants";
import {fail} from "assert";
import {RecordedArrayValuesRead} from "./class-trackers/Array";
import {RecordedMapEntriesRead} from "./class-trackers/Map";

beforeEach(() => {

});

function createSampleObjectGraph() {
    return {
        appName: "HelloApp",
        users: [{id: 1, name: "Bob", active: true}, {id: 2, name: "Alice", active: false}],
        nullable: null,
    }
}


describe('ProxyFacade tests', () => {
    test("Base implementation", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(sampleGraph);
        expect(proxy !== sampleGraph).toBeTruthy();
        expect(watchedProxyFacade.getProxyFor(proxy) === proxy).toBeTruthy(); // Should return the proxy again
        expect(proxy.appName).toBe("HelloApp");
        expect(proxy.users === sampleGraph.users).toBe(false);
        expect(proxy.users.length).toBe(2);
    })

    test("Arrays", () => {
        const origArray = ["a", "b", "c"]
        const proxy = new WatchedProxyFacade().getProxyFor(origArray);
        expect(proxy[0]).toBe("a");
        expect(proxy.length).toBe(3);

        const collected = [];
        for(const i of proxy) {
            collected.push(i);
        }
        expect(collected).toEqual(origArray);
    })



    test("Functions. 'this' should be the proxy", () => {
        const origObj = {
            thisIsOrigObj() {
                return this === origObj;
            }
        };
        const proxy = new WatchedProxyFacade().getProxyFor(origObj);
        expect(proxy.thisIsOrigObj()).toBeFalsy();
    })

    test("Property accessors. 'this' should be the proxy", () => {
        const origObj = {
            get thisIsOrigObj() {
                return this === origObj;
            },

            set checkThisShouldNotBeOrigObj(value: string) {
                if(this === origObj) {
                    throw new Error("Assertion check failed");
                }
            }
        };
        const proxy = new WatchedProxyFacade().getProxyFor(origObj);
        expect(proxy.thisIsOrigObj).toBeFalsy();
        proxy.checkThisShouldNotBeOrigObj = "dummy";
    })

    test("Property accessors. 'this' should be the proxy - for subclasses", () => {
        let origObj: any;
        class Base {
            get thisIsOrigObj() {
                return this === origObj;
            }

            set checkThisShouldNotBeOrigObj(value: string) {
                if(this === origObj) {
                    throw new Error("Assertion check failed");
                }
            }
        }
        class Sub extends Base {

        }
        origObj = new Sub();

        const proxy = new WatchedProxyFacade().getProxyFor(origObj);
        expect(proxy.thisIsOrigObj).toBeFalsy();
        proxy.checkThisShouldNotBeOrigObj = "dummy";
    })

    test("Property accessors: 'this' should be the topmost proxy when using 2 layers of proxies", () => {
        const origObj = {
            get thisIsProxy2() {
                return this === proxy2;
            },

            set checkThisShouldBeProxy2(value: string) {
                if(this !== proxy2) {
                    throw new Error("Assertion check failed");
                }
            }
        };
        const proxy1 = new WatchedProxyFacade().getProxyFor(origObj);
        const proxy2 = new WatchedProxyFacade().getProxyFor(proxy1);
        expect(proxy2.thisIsProxy2).toBeTruthy();
        proxy2.checkThisShouldBeProxy2 = "dummy";
    })

    test("Set a property that does not exist", () => {
        const origObj = {} as any;
        const proxy = new WatchedProxyFacade().getProxyFor(origObj);
        const subObj = {};
        proxy.myNewProperty = subObj
        expect(proxy.myNewProperty === subObj).toBeFalsy(); // Should be a proxy of it
        expect(Object.keys(proxy)).toEqual(["myNewProperty"]);
    })


    test("instaceof", () => {
        class MyClass {

        }
        const origObj = new MyClass();
        const proxy = new WatchedProxyFacade().getProxyFor(origObj);
        expect(proxy instanceof MyClass).toBeTruthy();
    });

    test("delete property", () => {
        const origObj = {
            a: "b"
        };
        const proxy = new WatchedProxyFacade().getProxyFor(origObj);
        expect(Reflect.ownKeys(proxy)).toStrictEqual(["a"]);
        //@ts-ignore
        delete proxy.a;
        expect(proxy.a).toBeUndefined();
        expect(Reflect.ownKeys(proxy)).toStrictEqual([]);
    });




    test("Readonly props should not cause an error - fails - skipped", ()=> {
        return; // skip, cause we wont fix this soon

        const orig:{prop: object} = {} as any
        Object.defineProperty(orig, "prop", {
            value: {},
            writable: false
        })

        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(orig);
        expect(proxy.prop).toStrictEqual(orig.prop);
    })
});

describe('ProxyFacade and installed write tracker tests', () => {
    for (const mode of [{
        name: "ProxyFacade", proxyOrEnhance<T extends object>(o: T) {
            return new WatchedProxyFacade().getProxyFor(o)
        }
    }, {
        name: "Installed write tracker", proxyOrEnhance<T extends object>(o: T) {
            installChangeTracker(o);
            return o;
        }
    }]) {

        test(`${mode.name}: Object.keys`, () => {
            const origObj = {a: "x", arr:["a","b"]};
            const proxy = mode.proxyOrEnhance(origObj);
            expect(Object.keys(proxy)).toEqual(["a", "arr"]);
            expect(Object.keys(proxy.arr)).toEqual(Object.keys(origObj.arr));
        })

        test(`${mode.name}: Non modification`, () => {
            const origObj = {a: "a"};
            const proxy = mode.proxyOrEnhance(origObj);
            proxy.a = "a"; // Should at least not trigger an error
        })

        test(`${mode.name}: Property accessors`, () => {
            const origObj = new class {
                get artificialProprty() {
                    return "some";
                }

                _a = "";

                get a() {
                    return this._a;
                }

                set a(value: string) {
                    this._a = value;
                }

                set setMe(value: string) {
                    this._a = value;
                }
            }

            const proxy = mode.proxyOrEnhance(origObj);

            expect(proxy.a).toEqual("");

            proxy.a = "x"
            expect(proxy.a).toEqual("x");

            proxy.setMe = "y"
            expect(proxy.a).toEqual("y");

            expect(proxy.artificialProprty).toEqual("some");

        })

        test(`${mode.name}: Readonly props from prototypes should not cause an error`, ()=> {
            class A {
                prop!: object
            }
            Object.defineProperty(A.prototype, "prop", {
                value: {},
                writable: false
            })

            const orig = new A();

            const proxy = mode.proxyOrEnhance(orig);
            expect(proxy.prop).toStrictEqual(orig.prop);
        })

        test(`${mode.name}: Class hierarchy should be intact`, ()=> {
            let called: string = "";
            class A {
                myMethodOnlyA() {
                    return "a"
                }
                get propWithGetterOnlyA() {
                    return "a";
                }
                set setterOnlyA(value: string) {
                    if(value !== "v") {
                        throw new Error("invalid value")
                    }
                    called+="a";
                }

                myMethod() {
                    return "a"
                }

                myMethodWithSuper() {
                    return "a"
                }
                get propWithSuperGetter() {
                    return "a";
                }
                set setterWithSuper(value: string) {
                    if(value !== "v") {
                        throw new Error("invalid value")
                    }
                    called+="a";
                }

            }

            class B extends A {
                myMethod() {
                    return "b"
                }

                myMethodWithSuper() {
                    return super.myMethodWithSuper() + "b";
                }

                get propWithGetter() {
                    return "b";
                }
                get propWithSuperGetter() {
                    return super.propWithSuperGetter + "b";
                }
                set setterWithSuper(value: string) {
                    if(value !== "v") {
                        throw new Error("invalid value")
                    }
                    super.setterWithSuper = value;
                    called+="b";
                }

            }

            const b = mode.proxyOrEnhance(new B());
            expect(b.myMethod()).toEqual("b");
            expect(b.myMethodOnlyA()).toEqual("a");
            expect(b.myMethodWithSuper()).toEqual("ab");
            expect(b.propWithGetter).toEqual("b");
            expect(b.propWithGetterOnlyA).toEqual("a");
            expect(b.propWithSuperGetter).toEqual("ab");
            called="";b.setterOnlyA = "v";expect(called).toEqual("a");
            called="";b.setterWithSuper = "v";expect(called).toEqual("ab");

            expect(b instanceof B).toBeTruthy();
            expect(b instanceof A).toBeTruthy();

        });

        test(`${mode.name}: Writes arrive`, ()=> {
            const orig:any = {a: "x", counter: 0}
            const proxy = mode.proxyOrEnhance(orig);
            expect(proxy.a).toEqual("x");
            proxy.b = "2"
            expect(proxy.b).toEqual("2");
            expect(orig.b).toEqual("2");
            orig.c = "3"
            expect(proxy.c).toEqual("3");

            proxy.counter++;
            proxy.counter++;
            expect(proxy.counter).toEqual(2);
        } )

        /*
        // Not possible with installed write tracker
        test(`${mode.name}: Prototype should be the same`, () => {
            const orig:any = {a: "x", counter: 0}
            const protoOrig = Object.getPrototypeOf(orig);
            const proxy = mode.proxyOrEnhance(orig);
            expect(protoOrig === Object.getPrototypeOf(proxy)).toBeTruthy();

        });
        */
        test(`${mode.name}: Constructor should be the same`, () => {
            for(const obj of [{}, new Set, new Map, []]) {
                const orig: object = obj
                const constructorOrig = obj.constructor;
                const proxy = mode.proxyOrEnhance(orig);
                expect(constructorOrig === proxy.constructor).toBeTruthy();
            }

        });

    }
});

describe('WatchedProxyFacade tests', () => {
    function readsEqual(reads: RecordedPropertyRead[], expected: { obj: object, key?: ObjKey, value?: unknown, values?: unknown[] }[]) {
        function arraysAreShallowlyEqual(a?: unknown[], b?: unknown[]) {
            if((a === undefined) && (b === undefined)) {
                return true;
            }
            if(a === undefined || b === undefined) {
                return false;
            }
            if(a.length !== b.length) {
                return false;
            }
            for(let i = 0;i<a.length;i++) {
                if(a[i] !== b[i]) {
                    return false;
                }
            }
            return true;
        }

        return arraysAreEqualsByPredicateFn(reads, expected, (propRead, exp) => {
            return propRead.origObj === exp.obj && propRead.key === exp.key && propRead.value === exp.value && arraysAreShallowlyEqual((propRead as unknown as RecordedArrayValuesRead).values, exp.values);
        })
    }

    test("onAfterRead", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(sampleGraph);
        let reads: RecordedPropertyRead[] = [];
        watchedProxyFacade.onAfterRead(r => reads.push(r as RecordedPropertyRead));

        reads = [];
        expect(proxy.appName).toBeDefined();
        expect(readsEqual(reads, [{obj: sampleGraph, key: "appName", value: "HelloApp"}])).toBeTruthy();

        reads = [];
        expect(proxy.nullable).toBeNull();
        expect(readsEqual(reads, [{obj: sampleGraph, key: "nullable", value: null}])).toBeTruthy();

        reads = [];
        expect(proxy.users[0]).toBeDefined();
        expect(readsEqual(reads, [
            {obj: sampleGraph, key: "users", value: sampleGraph.users},
            {obj: sampleGraph.users, key: "0", value: sampleGraph.users[0]}
        ])).toBeTruthy();
    })

    test("onAfterRead - iterate array", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(sampleGraph);
        let reads: RecordedPropertyRead[] = [];
        watchedProxyFacade.onAfterRead(r => reads.push(r as RecordedPropertyRead));

        // Iterate an array
        reads = [];
        proxy.users.forEach(user => expect(user).toBeDefined());
        expect(readsEqual(reads, [
            {obj: sampleGraph, key: "users", value: sampleGraph.users},
            {obj: sampleGraph.users, values: sampleGraph.users},
            {obj: sampleGraph.users, key: "0", value: sampleGraph.users[0]},
            {obj: sampleGraph.users, key: "1", value: sampleGraph.users[1]},
        ])).toBeTruthy();

    });

    test("onAfterRead - whitebox getters", () => {
        const origObj = {
            _prop: true,
            get prop() {
                return this._prop;
            }
        }
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(origObj);

        // Install listener:
        let reads: RecordedPropertyRead[] = [];
        watchedProxyFacade.onAfterRead(r => reads.push(r as RecordedPropertyRead));

        expect(proxy.prop).toBeDefined();
        expect(readsEqual(reads,[{obj: origObj, key: "_prop", value: true}])).toBeTruthy();
    });

    test("onAfterWrite", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(sampleGraph);

        // Install listener:
        let writes: unknown[] = [];
        watchedProxyFacade.onAfterWriteOnProperty(proxy, "appName", () => writes.push("dummy"));

        proxy.appName = "xyz"; proxy.appName = "123";
        expect(writes.length).toEqual(2)

    });

    test("onAfterWrite increase counter with ++", () => {
        const sampleGraph = {counter: 0};
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(sampleGraph);

        // Install listener:
        let writes: unknown[] = [];
        watchedProxyFacade.onAfterWriteOnProperty(proxy, "counter", () => writes.push("dummy"));

        proxy.counter++;
        expect(writes.length).toEqual(1);

    });

    it("should not fire onChange when value stays the same", ()=> {
        // TODO
    })

    test("isArray should work on a proxy", () => {
        const origObj: any[] = [];
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(origObj);
        expect(Array.isArray(proxy)).toBeTruthy();
        expect(_.isArray(proxy)).toBeTruthy();
    })

    test("Template", () => {
        const sampleGraph = createSampleObjectGraph();
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(sampleGraph);
    });


    test("Created independant objects inside user methods should not fire reads", () => {
        class UsersClass {
            childObject = {prop: "childObjectsValue"}

            getNewObject() {
                return {

                }
            }

            getNewArray() {
                return []
            }
        }

        const facade = new WatchedProxyFacade();
        let thereWasAread = false;
        facade.onAfterRead(() => {
            thereWasAread = true;
        })
        const orig = new UsersClass();
        const proxy = facade.getProxyFor(orig);

        read(proxy.getNewObject());
        expect(thereWasAread).toBeFalsy();

        read(proxy.getNewArray());
        expect(thereWasAread).toBeFalsy();
    });


    test("Arrays should work normally when when creating the proxy, **after** the write tracker has been installed ", () => {
        const orig: any[] = ["a", "b",{name: "c"}];
        installChangeTracker(orig);
        orig.push({name: "d"});
        const facade = new WatchedProxyFacade();
        const proxy = facade.getProxyFor(orig);
        proxy.push({name: "e"});
        for(const obj of [proxy, orig]) {
            expect(Object.keys(obj)).toEqual(["0", "1", "2", "3", "4"]);
            expect(obj[2].name).toBe("c");
            expect(obj[3].name).toBe("d");
            expect(obj[4].name).toBe("e");
        }
    })

    test("Sets should work normally when when creating the proxy, **after** the write tracker has been installed ", () => {
        const itemB = {name: "b"};
        const itemC = {name: "c"};
        const itemD = {name: "d"};
        const itemE = {name: "e"};
        const orig = new Set<any>(["a", itemB])
        installChangeTracker(orig);
        orig.add(itemC);
        const facade = new WatchedProxyFacade();
        const proxy = facade.getProxyFor(orig);
        proxy.add(itemD);
        proxy.add(facade.getProxyFor(itemE));
        for(const obj of [proxy, orig]) {
            expect(obj.size).toBe(5);
            expect([...obj][1].name).toBe("b");
            expect([...obj][2].name).toBe("c");
            expect([...obj][3].name).toBe("d");
            expect([...obj][4].name).toBe("e");
        }
        expect([...orig][4] === itemE).toBeTruthy();
        expect([...proxy][4] === itemE).toBeFalsy();

    })

    test("Maps should work normally when when creating the proxy, **after** the write tracker has been installed ", () => {
        const keyB = {key: "b"};
        const keyC = {key: "c"};
        const keyD = {key: "d"};
        const keyE = {key: "e"};
        
        const valueB = {value: "b"};
        const valueC = {value: "c"};
        const valueD = {value: "d"};
        const valueE = {value: "e"};
        const orig = new Map<any,any>([["a","a"], [keyB,valueB]])
        installChangeTracker(orig);
        orig.set(keyC, valueC);
        const facade = new WatchedProxyFacade();
        const proxy = facade.getProxyFor(orig);
        proxy.set(keyD, valueD);
        proxy.set(facade.getProxyFor(keyE), facade.getProxyFor(valueE));
        for(const obj of [proxy, orig]) {
            expect(obj.size).toBe(5);
            expect([...obj][1][0].key).toBe("b");
            expect([...obj][2][0].key).toBe("c");
            expect([...obj][3][0].key).toBe("d");
            expect([...obj][4][0].key).toBe("e");

            expect([...obj][1][1].value).toBe("b");
            expect([...obj][2][1].value).toBe("c");
            expect([...obj][3][1].value).toBe("d");
            expect([...obj][4][1].value).toBe("e");
        }
        expect([...orig][4][1] === valueE).toBeTruthy();
        expect([...proxy][4][1] === valueE).toBeFalsy();
        expect([...orig][4][0] === keyE).toBeTruthy();
        expect([...proxy][4][0] === keyE).toBeFalsy();

    })

    test("It should not unwrap values of another proxyfacade",() => {
        const orig= {};
        const facadeA = new WatchedProxyFacade();
        const proxyA = facadeA.getProxyFor(orig);
        const facadeB = new WatchedProxyFacade();
        const someObjOrig = {} as any;
        const someObjProxyB = facadeB.getProxyFor(someObjOrig);
        someObjProxyB.value = proxyA; // Should not unwrap proxyA and store orig
        expect(someObjOrig.value === proxyA).toBeTruthy();
    })

    test("Track getters", () => {
        const orig = {
            _value: "123",
            get value() {
                return this._value;
            },
            get value_outer() {
                return this.value;
            }
        }
        const facade = new WatchedProxyFacade();
        facade.trackGetterCalls = true;
        let hadRead = false;
        facade.onAfterRead(read => {
            if(read instanceof RecordedPropertyRead) {
                expect(read.proxyHandler.facade.currentOutermostGetter!.key === "value_outer");
                hadRead = true
            }
        });
        read(facade.getProxyFor(orig).value_outer);
        expect(hadRead).toBeTruthy();

    })
});


describe('WatchedProxyFacade record read and watch it', () => {
    /**
     * Just do something the runtime can't optimize away
     * @param value
     */
    function read(value: any) {
        if( ("" + value) == "blaaxyxzzzsdf" ) {
            throw new Error("should never get here")
        }
    }

    const testRecordedRead_isChanged_alreadyHandled = new Set<(obj: any) => void>();
    function testRecordedRead_isChanged<T extends object>(provideTestSetup: () => {origObj: T, readerFn: (obj: T) => void}) {
        const testSetup = provideTestSetup()

        if(testRecordedRead_isChanged_alreadyHandled.has(testSetup.readerFn)) { // Already handled?
            return;
        }
        testRecordedRead_isChanged_alreadyHandled.add(testSetup.readerFn);

        test(`${fnToString(testSetup.readerFn)}: All RecordedRead#isChanged should stay false`, () => {
            let watchedProxyFacade = new WatchedProxyFacade();
            const proxy = watchedProxyFacade.getProxyFor(testSetup.origObj);
            let reads: RecordedPropertyRead[] = [];
            watchedProxyFacade.onAfterRead(r => reads.push(r as RecordedPropertyRead));
            testSetup.readerFn!(proxy);
            reads.forEach(read => {
                if(read.isChanged) {
                    read.isChanged; // set breakpoint here
                    fail(`${read.constructor.name}.isChanged returned true`)
                }
            });
        });
    }

    function testRecordReadAndWatch<T extends object>(name: string, provideTestSetup: () => {origObj: T, readerFn?: (obj: T) => void, writerFn?: (obj: T) => void, falseReadFn?: (obj: T) => void, falseWritesFn?: (obj: T) => void, skipTestReadsAreEqual?: boolean, pickRead?: Clazz}) {
        if(provideTestSetup().readerFn && !provideTestSetup().skipTestReadsAreEqual) {
            testRecordedRead_isChanged(provideTestSetup as any);
        }
        if(provideTestSetup().writerFn) {
            testWriterConsitency(provideTestSetup as any);
            testPartialGraph_onchange_withFriterFn(provideTestSetup as any);
        }

        for(const withLayeredFacades of [false, true]) {
            for (const mode of ["With writes through WatchedProxyFacade proxy", "With writes through installed write tracker", "With writes through 2 layered WatchedProxyFacade facades"]) {
                test(`${name} ${withLayeredFacades?" With layered facades. ":""} ${mode}`, () => {
                    const testSetup = provideTestSetup();

                    //writerFn:
                    if(testSetup.writerFn && testSetup.readerFn){
                        const testSetup = provideTestSetup();
                        let watchedProxyFacade = new WatchedProxyFacade();
                        let origObj = testSetup.origObj;
                        if(withLayeredFacades) {
                            origObj = new WatchedProxyFacade().getProxyFor(origObj);
                        }
                        const proxy = watchedProxyFacade.getProxyFor(origObj);
                        let reads: RecordedRead[] = [];
                        watchedProxyFacade.onAfterRead(r => reads.push(r));
                        reads = [];
                        testSetup.readerFn!(proxy);
                        expect(reads.length).toBeGreaterThan(0);
                        const lastRead = getLastRead(reads, testSetup);

                        const changeHandler = vitest.fn(() => {
                            const i = 0; // set breakpoint here
                        });
                        if (mode === "With writes through WatchedProxyFacade proxy") {
                            lastRead.onAfterChange(changeHandler);
                            testSetup.writerFn!(proxy);
                        } else if (mode === "With writes through installed write tracker") {
                            lastRead.onAfterChange(changeHandler, true);
                            testSetup.writerFn!(origObj);
                        } else if (mode === "With writes through 2 layered WatchedProxyFacade facades") {
                            lastRead.onAfterChange(changeHandler, true);
                            let watchedProxyFacade2 = new WatchedProxyFacade();
                            const proxy2 = watchedProxyFacade2.getProxyFor(origObj);
                            testSetup.writerFn!(proxy2);
                        }
                        expect(changeHandler).toBeCalledTimes(1);
                        lastRead.offAfterChange(changeHandler);
                    }

                    //falseWriteFn:
                    if (testSetup.falseWritesFn) {
                        const testSetup = provideTestSetup();
                        let origObj = testSetup.origObj;
                        let watchedProxyFacade = new WatchedProxyFacade();
                        const proxy = watchedProxyFacade.getProxyFor(withLayeredFacades?new WatchedProxyFacade().getProxyFor(testSetup.origObj):testSetup.origObj);
                        let reads: RecordedPropertyRead[] = [];
                        watchedProxyFacade.onAfterRead(r => reads.push(r as RecordedPropertyRead));
                        reads = [];
                        testSetup.readerFn!(proxy);
                        const lastRead = getLastRead(reads, testSetup);

                        const changeHandler = vitest.fn(() => {
                            const i = 0; // set breakpoint here
                        });
                        if (mode === "With writes through WatchedProxyFacade proxy") {
                            lastRead.onAfterChange(changeHandler);
                            testSetup.falseWritesFn!(proxy);
                        } else if (mode === "With writes through installed write tracker") {
                            lastRead.onAfterChange(changeHandler, true);
                            testSetup.falseWritesFn!(origObj);
                        } else if (mode === "With writes through 2 layered WatchedProxyFacade facades") {
                            lastRead.onAfterChange(changeHandler, true);
                            let watchedProxyFacade2 = new WatchedProxyFacade();
                            const proxy2 = watchedProxyFacade2.getProxyFor(origObj);
                            testSetup.falseWritesFn!(proxy2);
                        }
                        expect(changeHandler).toBeCalledTimes(0);
                        lastRead.offAfterChange(changeHandler);
                    }


                    //falseReadFn:
                    if (testSetup.falseReadFn !== undefined) {
                        const testSetup = provideTestSetup();
                        let origObj = testSetup.origObj;
                        let watchedProxyFacade = new WatchedProxyFacade();
                        const proxy = watchedProxyFacade.getProxyFor(withLayeredFacades?new WatchedProxyFacade().getProxyFor(testSetup.origObj):testSetup.origObj);
                        let reads: RecordedPropertyRead[] = [];
                        watchedProxyFacade.onAfterRead(r => reads.push(r as RecordedPropertyRead));
                        testSetup.falseReadFn!(proxy);
                        expect(reads.length).toBeGreaterThan(0);
                        const lastRead = getLastRead(reads, testSetup);
                        const changeHandler = vitest.fn(() => {
                            const i = 0;// set breakpoint here
                        });

                        if (mode === "With writes through WatchedProxyFacade proxy") {
                            lastRead.onAfterChange(changeHandler);
                            testSetup.writerFn!(proxy);
                        } else if (mode === "With writes through installed write tracker") {
                            lastRead.onAfterChange(changeHandler, true);
                            testSetup.writerFn!(origObj);
                        } else if (mode === "With writes through 2 layered WatchedProxyFacade facades") {
                            lastRead.onAfterChange(changeHandler, true);
                            let watchedProxyFacade2 = new WatchedProxyFacade();
                            const proxy2 = watchedProxyFacade2.getProxyFor(origObj);
                            testSetup.writerFn!(proxy2);
                        }

                        expect(changeHandler).toBeCalledTimes(0);
                        lastRead.offAfterChange(changeHandler);
                    }
                });
            }
        }
        for(const withTrackOriginal of [false, true]) {
            if(provideTestSetup().readerFn && !provideTestSetup().skipTestReadsAreEqual) {
                test(`${name}: Recorded reads are equal, when run twice${withTrackOriginal ? ` with track original` : ""}`, () => {
                    // readerFns reads are equal?
                    const testSetup = provideTestSetup();
                    let watchedProxyFacade = new WatchedProxyFacade();
                    const proxy = watchedProxyFacade.getProxyFor(testSetup.origObj);
                    let reads: RecordedRead[] = [];
                    watchedProxyFacade.onAfterRead(r => {
                        reads.push(r as RecordedPropertyRead);
                        if (withTrackOriginal) {
                            r.onAfterChange(() => {
                            }, true);
                        }
                    });

                    // 1st time:
                    testSetup.readerFn!(proxy);
                    expect(reads.length).toBeGreaterThan(0);
                    const reads1 = reads;

                    // 2nd time:
                    reads = [];
                    testSetup.readerFn!(proxy);
                    const reads2 = reads;

                    expect(recordedReadsArraysAreEqual(reads1, reads2)).toBeTruthy();
                })
            }
        }

        if(provideTestSetup().writerFn && provideTestSetup().readerFn) {
            test(`${name} proper cleanup of listeners`, () => {
                const testSetup = provideTestSetup();
                let watchedProxyFacade = new WatchedProxyFacade();
                let origObj = testSetup.origObj;
                const proxy = watchedProxyFacade.getProxyFor(origObj);
                let reads: RecordedRead[] = [];
                watchedProxyFacade.onAfterRead(r => reads.push(r));
                testSetup.readerFn!(proxy);
                const lastRead = getLastRead(reads, testSetup);
                let numChanges = 0
                const changeHandler = vitest.fn(() => {
                    numChanges++;
                });
                lastRead.onAfterChange(changeHandler);
                testSetup.writerFn!(proxy);
                expect(numChanges).toBeGreaterThan(0)
                lastRead.offAfterChange(changeHandler);
                numChanges = 0;
                testSetup.writerFn!(proxy);
                expect(numChanges).toBe(0);
            });
        }

        function getLastRead(reads: RecordedRead[], testSetup: ReturnType<typeof provideTestSetup>) {
            const r = testSetup.pickRead?reads.filter(r => r instanceof testSetup.pickRead!):reads;
            expect(r.length).toBeGreaterThan(0);
            return r[r.length - 1];
        }
    }


    testRecordReadAndWatch("Set object property", () => {
        const obj: {someProp?: string} = {};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someProp)},
            writerFn: (obj) => {obj.someProp = "123"},
            falseReadFn: (obj) => {read((obj as any).someOtherProp)},
        }
    });

    testRecordReadAndWatch("Set object property2", () => {
        const obj: {someProp?: string} = {someProp: "123"};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someProp)},
            writerFn: (obj) => {obj.someProp = "456"},
            falseWritesFn: (obj) => {obj.someProp="123" /* same value */}
        }
    });

    for(const mode of [{name: "Object.keys", readerFn: (obj: object) => read(Object.keys(obj))}, {name: "For...in", readerFn: (obj: object) => {for(const key in obj) read(key)}}]) {

        testRecordReadAndWatch(`${mode.name}`, () => {
            const obj: Record<string, unknown> = {existingProp: "123"};
            return {
                origObj: obj,
                readerFn: mode.readerFn,
                writerFn: (obj) => {obj.someOtherProp = "456"},
                falseWritesFn: (obj) => {obj.existingProp="new";}
            }
        });


        testRecordReadAndWatch(`${mode.name} with delete`, () => {
            const obj: Record<string, unknown> = {existingProp: "123"};
            return {
                origObj: obj,
                readerFn: mode.readerFn,
                writerFn: (obj) => {deleteProperty(obj, "existingProp" as any)},
                falseWritesFn: (obj) => {obj.existingProp="new"; deleteProperty (obj as any, "anotherProp")}
            }
        });
    }

    testRecordReadAndWatch("Delete object property", () => {
        const obj: {someProp?: string} = {someProp: "123"};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someProp)},
            writerFn: (obj) => {deleteProperty(obj as any, "someProp")},
            falseReadFn: (obj) => {read((obj as any).someOtherProp)},
            falseWritesFn: (obj) => {deleteProperty (obj as any, "anotherProp")}
        }
    });

    testRecordReadAndWatch("Set deep property", () => {
        const obj: {someDeep: {someProp?: string}} = {someDeep: {}};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someDeep.someProp)},
            writerFn: (obj) => {obj.someDeep.someProp = "123"},
            falseReadFn: (obj) => {read((obj as any).someOtherDeep);},
            falseWritesFn: (obj) => {(obj as any).someOtherDeep = "345";}
        }
    });

    testRecordReadAndWatch("Set deep property2", () => {
        const obj: {someDeep: {someProp?: string}} = {someDeep: {someProp:"123"}};
        return {
            origObj: obj,
            readerFn: (obj) => {read(obj.someDeep.someProp)},
            writerFn: (obj) => {obj.someDeep.someProp = "345"},
            falseWritesFn: (obj) => {obj.someDeep.someProp="123" /* same value */}
        }
    });


    testRecordReadAndWatch("Set deep property 3", () => {return {
            origObj: {someDeep: {}} as any,
            writerFn: (obj) => {obj.someDeep.someProp = "123"},
            falseReadFn: (obj) => {read((obj as any).someDeep.someOtherProp)},
    }});

    testRecordReadAndWatch<string[]>("Read values of an array", () => {
        const obj: {} = {};
        return {
            origObj: ["a", "b", "c"],
            readerFn: (obj) => {read([...obj])},
            writerFn: (obj) => {obj.push("d")},
            falseWritesFn: (obj) => {obj[1] = "b"}
        }
    });

    testRecordReadAndWatch<string[]>("Read array.length", () => {
        const obj: {} = {};
        return {
            origObj: ["a", "b", "c"],
            readerFn: (obj) => {read(obj.length)},
            writerFn: (obj) => {obj.push("d")},
            falseWritesFn: (obj) => {obj[1] = "b"}
        }
    });

    // Key iteration:
    for(const mode of [{name: "Object.keys", readerFn: (obj: Array<unknown>) => read(Object.keys(obj))}, {name: "For...in", readerFn: (obj: Array<unknown>) => {for(const key in obj) read(key)}}]) {

        for(const writerFn of [(arr: Array<unknown>) => {arr.push("b")}, (arr:Array<unknown>) => arr.pop(), (arr: Array<unknown>) => arr[4] = "new", (arr: Array<unknown>) => arr[6] = "new", (arr: Array<unknown>) => deleteProperty(arr, 0)] ) {
            testRecordReadAndWatch(`Arrays with ${mode.name} with ${fnToString(writerFn)}`, () => {
                return {
                    origObj: ["a", 1, 2, {}],
                    readerFn: mode.readerFn,
                    writerFn
                }
            });
        }

        testRecordReadAndWatch(`Arrays with ${mode.name} with false writes`, () => {
            return {
                origObj: ["a", 1, 2, {}],
                readerFn: mode.readerFn,
                falseWritesFn: (arr) => {arr[0] = "a";}
            }
        });
    }

    const arrayIteratorFns: {readerFn: ((arr: Array<unknown>) => void), skipTestReadsAreEqual?: boolean, pickRead?: Clazz}[] = [{readerFn: arr => {for(const val of arr) read(val)}, pickRead: RecordedArrayValuesRead}, {readerFn:arr => read(arr.keys()), skipTestReadsAreEqual: true}, {readerFn:arr => read(arr.values())}, {readerFn:arr => read(arr.entries())}, {readerFn:arr => arr.forEach(v => read(v)), pickRead: RecordedArrayValuesRead}];
    const arrayChangeFns = [(arr: Array<unknown>) => {arr.push("b")}, (arr:Array<unknown>) => {arr[1] = 123}, (arr:Array<unknown>) => arr.pop(), (arr: Array<unknown>) => arr[4] = "new", (arr: Array<unknown>) => arr[6] = "new", (arr: Array<unknown>) => deleteProperty(arr, 0)];
    // Value iteration:
    for(const it of arrayIteratorFns) {
        const readerFn = it.readerFn
        for(const writerFn of arrayChangeFns ) {
            testRecordReadAndWatch(`Arrays with ${fnToString(readerFn)}} with ${fnToString(writerFn)}`, () => {
                return {
                    origObj: ["a", 1, 2, {}],
                    readerFn,
                    writerFn,
                    skipTestReadsAreEqual: it.skipTestReadsAreEqual,
                    pickRead: it.pickRead,
                }
            });
        }

        testRecordReadAndWatch(`Arrays with ${fnToString(readerFn)}} with false writes`, () => {
            return {
                origObj: ["a", 1, 2, {}],
                readerFn,
                falseWritesFn: (arr) => {arr[0] = "a";},
                skipTestReadsAreEqual: it.skipTestReadsAreEqual,
                pickRead: it.pickRead,
            }
        });
    }


    // TODO: non enumerable properties

    for(const readWriteFn of [(arr: any[]) => arr.pop()] ) {
        testRecordReadAndWatch(`Arrays with Read-Write method: ${fnToString(readWriteFn)}`, () => {
            return {
                origObj: ["a", 1, 2, {}],
                readerFn: readWriteFn,
                writerFn: readWriteFn,
                skipTestReadsAreEqual: true
            }
        });
    }

    for(const readerFn of [(obj: string[]) => Object.keys(obj), (obj: string[]) => obj[0], (obj: string[]) => {for(const o of obj) read(o)}]) {
         testRecordReadAndWatch(`Future functionality of array with reader: ${fnToString(readerFn)}`, () => {
            return {
                origObj: ["a", "b", "c"],
                readerFn,
                writerFn: (obj) => {
                    function someFuturisticMethod(this: unknown, a: unknown, b: unknown) {
                        return {a, b, me: this};
                    }

                    //@ts-ignore
                    Array.prototype.someFuturisticMethod = someFuturisticMethod; // Enhance Array
                    try {
                        const result = (obj as any).someFuturisticMethod("a", "b");
                        // Check if params were handed correctly
                        expect(result.a).toBe("a")
                        expect(result.b).toBe("b")

                        expect(result.me === obj).toBeTruthy(); // Expect to someFuturisticMethod to receive the proper "this"
                    } finally {
                        //@ts-ignore
                        delete Array.prototype.someFuturisticMethod;
                    }

                },
            }
        });
    }

    testRecordReadAndWatch(`Future/unhandled read methods on array should fire an unspecific read`, () => {
        return {
            origObj: ["a", "b", "c"],
            readerFn: (obj) => {
                function someFuturisticMethod(this: unknown, a: unknown, b: unknown) {
                    return {a, b, me: this};
                }

                //@ts-ignore
                Array.prototype.someFuturisticMethod = someFuturisticMethod; // Enhance Array
                try {
                    const result = (obj as any).someFuturisticMethod("a", "b");
                    // Check if params were handed correctly
                    expect(result.a).toBe("a")
                    expect(result.b).toBe("b")

                    expect(result.me === obj).toBeTruthy(); // Expect to someFuturisticMethod to receive the proper "this"

                    (obj as any).someFuturisticMethod("a", "b"); // Call that again, so the last read corresponds with the writerFn
                } finally {
                    //@ts-ignore
                    delete Array.prototype.someFuturisticMethod;
                }

            },
            writerFn: (obj) => {obj[3] = "d"},
            skipTestReadsAreEqual: true

        }
    });


    testRecordReadAndWatch<string[]>("methods from Object.prototype called on an array", () => {
        return {
            origObj: ["a", "b", "c"],
            readerFn: (obj) => {expect(obj.toString()).toBe('a,b,c')},
        }
    });

    testRecordReadAndWatch("array.unshift", () => {return {
        origObj: ["a", "b", "c"],
        readerFn: (obj: string[]) =>  read(obj[0]),
        writerFn: (obj: string[]) =>  obj.unshift("_a","_b"),
    }});

    testRecordReadAndWatch("array.unshift with .length", () => {return {
            origObj: ["a", "b", "c"],
            readerFn: (obj: string[]) =>  read(obj.length),
            writerFn: (obj: string[]) =>  obj.unshift("_a","_b"),
    }});

    testRecordReadAndWatch<Set<unknown>>("Set.add", () => {
        const obj: Set<string> = new Set<string>;
        return {
            origObj: obj,
            readerFn: (obj) => obj.has("a"),
            writerFn: (obj) => obj.add("a"),
            falseReadFn: (obj) => {obj.has("b")},
            falseWritesFn: (obj) => {obj.add("b")}
        }
    });

    testRecordReadAndWatch<Set<unknown>>("Set.add as non-change (value already exists)", () => {
        const obj: Set<string> = new Set<string>(["a", "b"]);
        return {
            origObj: obj,
            readerFn: (obj) => obj.has("a"),
            falseWritesFn: (obj) => {obj.add("a")}
        }
    });

    const iterateSetFns: ((set: Set<unknown>) => void)[] = [set => set.keys(), set => set.values(), set => set.forEach(x => read(x)), set => {for(const o of set) read(o)}, set => read(set.size)];
    const changeSetFns:((set: Set<unknown>) => void)[] = [set => set.add("d"), set => set.delete("b"), set => set.clear()]
    for(const readerFn of iterateSetFns) {
        for(const writerFn of changeSetFns) {
            testRecordReadAndWatch<Set<unknown>>(`Iterate set: ${fnToString(readerFn)} with ${fnToString(writerFn)}`, () => {
                return {
                    origObj: new Set<string>(["a", "b"]),
                    readerFn,
                    writerFn
                }
            });
        }
    }


    testRecordReadAndWatch<Map<unknown, unknown>>("Map.has with Map.set", () => {
        const obj: Map<string,string> = new Map<string,string>;
        return {
            origObj: obj,
            readerFn: (obj) => obj.has("a"),
            writerFn: (obj) => obj.set("a", {}),
            falseReadFn: (obj) => {obj.has("b")},
            falseWritesFn: (obj) => {obj.set("b", "c")}
        }
    });

    testRecordReadAndWatch<Map<string, unknown>>("Map.get with Map.set", () => {
        const obj: Map<string,string> = new Map<string,string>([["a","valueA"], ["b","valueB"]]);
        return {
            origObj: obj,
            readerFn: (obj) => expect(obj.get("a")).toBe("valueA"),
            writerFn: (obj) => obj.set("a", {val: "somethingElse"}),
            falseReadFn: (obj) => {obj.has("b"); obj.get("b")},
            falseWritesFn: (obj) => {obj.set("a", "valueA")} // No actual change
        }
    });

    {
        const createOrigMap = () => new Map<string,unknown>([["a","valueA"], ["b",{some: "valueB"}]]);
        const changeMapFns:((map: Map<unknown, unknown>) => void)[] = [map => map.set("d", {}), map => map.delete("b"), map => map.clear()]

        const iterateMapKeysFns: ((map: Map<unknown, unknown>) => void)[] = [map => map.keys(), map => read(map.size)];
        for(const readerFn of iterateMapKeysFns) {
            for(const writerFn of changeMapFns) {
                testRecordReadAndWatch<Map<unknown, unknown>>(`Iterate map keys: ${fnToString(readerFn)} with ${fnToString(writerFn)}`, () => {
                    return {
                        origObj: createOrigMap(),
                        readerFn,
                        writerFn,
                        falseWritesFn: obj => obj.set("a", "differentValue")
                    }
                });
            }
        }

        const iterateMapValuesFns: {readerFn: ((map: Map<unknown, unknown>) => void), skipTestReadsAreEqual?: boolean, pickRead?: Clazz}[] = [{readerFn:map => map.values()}, {readerFn:map => map.forEach(x => read(x))}, {readerFn:map => {for(const o of map) read(o)}, pickRead: RecordedMapEntriesRead}];
        for(const it of iterateMapValuesFns) {
            for(const writerFn of changeMapFns) {
                testRecordReadAndWatch<Map<unknown, unknown>>(`Iterate map values: ${fnToString(it.readerFn)} with ${fnToString(writerFn)}`, () => {
                    return {
                        origObj: createOrigMap(),
                        readerFn: it.readerFn,
                        writerFn,
                        skipTestReadsAreEqual: it.skipTestReadsAreEqual,
                        pickRead: it.pickRead,
                    }
                });
            }
        }
    }


    testRecordReadAndWatch<Map<unknown, unknown>>("Map.keys() (more fine granualar)", () => {
        const map: Map<string,string> = new Map<string,string>([["keyA", "valueA"], ["keyB", "valueB"]]);
        return {
            origObj: map,
            readerFn: (map) => read(map.keys()),
            writerFn: (map) => map.set("keyC", "valueC"),
            falseReadFn: (map) => {map.has("keyX")},
            falseWritesFn: (map) => {map.set("keyA", "differentVALUE")} // only the value differs
        }
    });

    testRecordReadAndWatch<Map<unknown, unknown>>("Map.values() (more fine granualar)", () => {
        const map: Map<string,string> = new Map<string,string>([["keyA", "valueA"], ["keyB", "valueB"]]);
        return {
            origObj: map,
            readerFn: (map) => read(map.values()),
            writerFn: (map) => map.set("keyA", "newValue"),
            falseWritesFn: (map) => {map.set("keyA", "valueA")},
        }
    });


    /* Template:
    testRecordReadAndWatch("xxx", () => {
        const obj: {} = {};
        return {
            origObj: obj,
            readerFn: (obj) => {...},
            writerFn: (obj) => {...},
            falseReadFn: (obj) => {},
            falseWritesFn: (obj) => {}
        }
    });
    */
});

describe('WatchedProxyFacade integrity', () => {
    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c"],
        writerFn: (obj: string[]) => {
            expect(obj.push("d")).toEqual(4);
            expect(obj.length).toEqual(4);

            expect(obj.push("e","f")).toEqual(6);
        }}
    },"array.push (various)");

    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c"],
        writerFn: (obj: string[]) => {
            expect(obj.pop()).toEqual("c");
            expect(obj.length).toEqual(2);
        }}
    },"array.pop (various)");


    testWriterConsitency(() => {
        const makeArray = (value: unknown[]) => {
            let result: unknown[] = [];
            for (const i in value) {
                if (value[i] !== undefined) {
                    result[i] = value[i];
                }
            }
            return result
        }

        return {
        origObj: makeArray(["a", undefined, undefined, "d"]),
        writerFn: (obj: unknown[]) => {
            expect(obj.length).toEqual(4);
            expect([...Object.keys(obj)]).toEqual(["0", "3"]);
            expect(obj.pop()).toEqual("d");
            expect(obj.length).toBe(3);
        }}
    },"arrays with gaps");


    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c","d"],
        writerFn: (obj: string[]) => {
            expect(obj.slice(1,3)).toEqual(["b","c"]);
        }}
    },"array.slice");

    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c"],
        writerFn: (obj: string[]) => {
            expect(obj.unshift("_a","_b")).toBe(5);
            expect([...obj]).toEqual(["_a","_b", "a", "b", "c"]);
        }}
    },"array.unshift");



    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c","d"],
        writerFn: (obj: string[]) => {
            expect(obj.splice(1,2, "newB", "newC", "newX")).toEqual(["b","c"]);
            expect([...obj]).toEqual(["a", "newB", "newC", "newX", "d"]);
        }}
    },"array.splice");



    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c","d"] as any[],
        writerFn: (obj: string[]) => {
            expect([...obj.copyWithin(3, 1,3)]).toEqual(["a", "b", "c","b"]);
            expect(obj.length).toBe(4);
        }}
    },"array.copyWithin");

    testWriterConsitency(() => {return {
        origObj: ["a", "b", "c","d"] as any[],
        writerFn: (obj: string[]) => {
            expect([...obj.reverse()]).toEqual(["d", "c", "b","a"]);
            expect([...obj]).toEqual(["d", "c", "b","a"]);
        }}
    },"array.reverse");


    testWriterConsitency(() => {return {
        origObj: new Set<string>(),
        writerFn: (set: Set<string>) => {
            set.add("a");set.add("b");set.add("a");
            expect(set.has("a")).toBeTruthy();
            expect(set.has("c")).toBeFalsy();
            expect(set.size).toEqual(2);
            expect([...set.keys()]).toEqual(["a","b"]);
            expect([...set.values()]).toEqual(["a","b"]);
            expect([...set.entries()]).toEqual([["a", "a"],["b","b"]]);
            expect(set[Symbol.iterator]().next().value).toEqual("a");
            const res: string[] = [];
            set.forEach(v => res.push(v));
            expect(res).toEqual(["a","b"]);
            expect(set.delete("c")).toBeFalsy();
            expect(set.size).toEqual(2);
            expect(set.delete("b")).toBeTruthy();
            expect(set.size).toEqual(1);
            set.clear();
            expect(set.size).toEqual(0);
        }}
    },"Set");

});

describe("Returning proxies", () => {
    function testExpectOperationToReturnProxy<T extends object>(mkOrig: () => T, operation: (o: T) => object, expectProxy = true) {
        test(`Expect result of ${fnToString(operation)} to ${expectProxy?"":"not "}be a proxy`, () => {
            {
                const watchedProxyFacade = new WatchedProxyFacade();
                const util = new WgUtil(watchedProxyFacade);
                const orig = mkOrig();
                const proxy = watchedProxyFacade.getProxyFor(orig);

                if(expectProxy) {
                    util.expectProxy(operation(proxy));
                }
                else {
                    util.expectNonProxy(operation(proxy));
                }
            }

            {
                const watchedProxyFacade = new WatchedProxyFacade();
                const util = new WgUtil(watchedProxyFacade);
                const orig = mkOrig();
                const proxy = watchedProxyFacade.getProxyFor(orig);
                util.expectNonProxy(operation(orig));
            }
        })
    }

    function testExpectOperationToReturnNonProxy<T extends object>(mkOrig: () => T, operation: (o: T) => object, expectProxy = true) {
        return testExpectOperationToReturnProxy(mkOrig, operation, false);
    }

    class WgUtil {
        watchedProxyFacade: WatchedProxyFacade

        constructor(watchedProxyFacade: WatchedProxyFacade) {
            this.watchedProxyFacade = watchedProxyFacade;
        }

        expectProxy(obj: object) {
            if (this.watchedProxyFacade.getProxyFor(obj) !== obj) {
                fail("obj is not a proxy");
            }
        }

        expectNonProxy(obj: object) {
            if (this.watchedProxyFacade.getProxyFor(obj) === obj) {
                fail("obj is a proxy");
            }
        }
    }

    test("Object properties should be proxies", () => {
        const watchedProxyFacade = new WatchedProxyFacade();
        const utils = new WgUtil(watchedProxyFacade);

        const orig = {
            prop: {child: "initialValue"} as object,

            get byAccessor() {
                return this.prop;
            },

            set byAccessor(value: object) {
                this.prop = value;
            },

            setProp(value: object) {
                this.prop = value;
            }
        }
        const proxyedObj = watchedProxyFacade.getProxyFor(orig);
        utils.expectProxy(proxyedObj);
        utils.expectProxy(proxyedObj.prop);

        // setting non-proxied
        proxyedObj.prop = {child: "newValue"}
        utils.expectProxy(proxyedObj.prop);
        utils.expectNonProxy(orig.prop);

        // setting proxied
        proxyedObj.prop = watchedProxyFacade.getProxyFor({child: "newValue"})
        utils.expectProxy(proxyedObj.prop);
        utils.expectNonProxy(orig.prop);

        utils.expectProxy(proxyedObj.byAccessor);
        proxyedObj.byAccessor= {child: "newValue"}
        utils.expectProxy(proxyedObj.prop)
        utils.expectNonProxy(orig.prop)

        proxyedObj.byAccessor= watchedProxyFacade.getProxyFor({child: "newValue"})
        utils.expectProxy(proxyedObj.prop)
        utils.expectNonProxy(orig.prop)

        proxyedObj.setProp({child: "newValue"})
        utils.expectProxy(proxyedObj.prop)
        utils.expectNonProxy(orig.prop)

        proxyedObj.setProp(watchedProxyFacade.getProxyFor({child: "newValue"}))
        utils.expectProxy(proxyedObj.prop)
        utils.expectNonProxy(orig.prop)
    })

    test("User methods should return proxies", () => {
        const watchedProxyFacade = new WatchedProxyFacade();
        const utils = new WgUtil(watchedProxyFacade);

        const orig = {
            someObj: {some: "value"},
            userMethod() {
                return this.someObj
            },

            equalsSomeObject(candidate: object) {
                return this.someObj === candidate;
            }
        }
        const proxy = watchedProxyFacade.getProxyFor(orig);
        utils.expectProxy(proxy);
        utils.expectProxy(proxy.someObj);
        utils.expectProxy(proxy.userMethod());

        expect(proxy.equalsSomeObject(proxy.someObj)).toBeTruthy(); // Behaviour should be consistent
    })

    test("Array should return proxies", () => {
        const watchedProxyFacade = new WatchedProxyFacade();
        const utils = new WgUtil(watchedProxyFacade);

        const obj1 = {};
        const obj2 = {};
        const orig = [obj1,obj2]
        const proxy = watchedProxyFacade.getProxyFor(orig);
        utils.expectProxy(proxy);
        utils.expectProxy(proxy[0]);

        const obj1Proxy = watchedProxyFacade.getProxyFor(obj1);
        expect(proxy.includes(obj1Proxy)).toBeTruthy();
        expect(proxy.indexOf(obj1Proxy) >=0).toBeTruthy();
        expect(proxy.lastIndexOf(obj1Proxy) >=0).toBeTruthy();

        //expect(proxy.includes(obj1)).toBeTruthy(); // Questionable if this should work. It's rather cleaner and more consistent if it doesn't

        proxy.push({x: "123"})
        utils.expectProxy(proxy[2]);
        utils.expectNonProxy(orig[2]);
        proxy.push(proxy[0]); // add again
        utils.expectNonProxy(orig[3]);

        proxy.forEach((value, index, array) => {
            utils.expectNonProxy(this as any as object);
            utils.expectProxy(value);
            utils.expectProxy(array);
        },{})

        utils.expectProxy(proxy.pop()!);
        utils.expectNonProxy(orig.pop()!);
    })

    testExpectOperationToReturnProxy(() => [{}], (arr) => arr[0])
    testExpectOperationToReturnProxy(() => [{}], (arr) => arr.pop()!)
    testExpectOperationToReturnProxy(() => [{}], (arr) => arr.shift()!)
    testExpectOperationToReturnProxy(() => [{}], (arr) => arr.at(0)!)
    testExpectOperationToReturnNonProxy(() => [{}], (arr) => arr.concat([{}]))
    testExpectOperationToReturnProxy(() => [{}], (arr) => arr.concat([{}]).at(0)! as object)
    testExpectOperationToReturnNonProxy(() => [{}], (arr) => arr.concat([{}]).at(1)! as object) // Element 1 is the concatenated one and still should be a non-proxy, cause it is not reachable by orig
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}, {t:"d"}, {t:"e"}], (arr) => arr.copyWithin(0, 3, 4))
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}, {t:"d"}, {t:"e"}], (arr) => arr.copyWithin(0, 3, 4).at(0)!)
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}], (arr) => arr.filter(x => x.t === "a")[0])
    testExpectOperationToReturnProxy(() => [{t:"a"}], (arr) => {let seen: any; arr.filter(x => seen = x); return seen})
    testExpectOperationToReturnProxy(() => [{t:"a"}], (arr) => {let seen: any; arr.some(x => seen = x); return seen})
    testExpectOperationToReturnProxy(() => [{t:"a"}], (arr) => {let seen: any; arr.find(x => seen = x); return seen})
    testExpectOperationToReturnProxy(() => [{t:"a"}], (arr) => {let seen: any; arr.findLast(x => seen = x); return seen})
    testExpectOperationToReturnProxy(() => [{t:"a"}], (arr) => {let seen: any; arr.findIndex(x => seen = x); return seen})
    testExpectOperationToReturnProxy(() => [{t:"a"}], (arr) => {let seen: any; arr.findLastIndex(x => seen = x); return seen})
    testExpectOperationToReturnProxy(() => [{t:"a"}], (arr) => {let seen: any; arr.map(x => seen = x); return seen})
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}], (arr) => arr.find(x => x.t === "a")!)
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}, [{t:"d"}, {t:"e"}]], arr => arr.flat()[0]);
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}, [{t:"d"}, {t:"e"}]], arr => arr.flat()[3]);
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}], (arr) => arr.reverse())
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}], (arr) => {arr.reverse(); return arr[2]});
    testExpectOperationToReturnNonProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}, {t:"d"}, {t:"e"}], arr => arr.slice(2,5))
    testExpectOperationToReturnProxy(() => [{t:"a"}, {t:"b"}, {t:"c"}, {t:"d"}, {t:"e"}], arr => arr.slice(2,5)[2])
    testExpectOperationToReturnProxy(() => [{},{},{}], arr => arr.values().next().value!)
    testExpectOperationToReturnProxy(() => [{},{},{}], arr => [...arr.values()][2])
    testExpectOperationToReturnProxy(() => [{},{},{}], arr => [...arr][2]) // test Symbol.iterator()
    testExpectOperationToReturnProxy(() => [{},{},{}], arr => {let seen: any; arr[Symbol.iterator]().forEach(x => seen = x); return seen}) // test Symbol.iterator() + it's forEach high-level method
    testExpectOperationToReturnProxy(() => [{},{},{}], arr => arr.entries().next().value![1]);
    testExpectOperationToReturnProxy(() => [{},{},{}], arr => [...arr.entries()][0][1]);

    test("Setting properties on an object should not self-infect", () => {
        const watchedProxyFacade = new WatchedProxyFacade();
        const utils = new WgUtil(watchedProxyFacade);

        const orig = {
            someObj: {some: "value"} as object,
            setSomeObj(value: object) {
                this.someObj = value;
            },
        }
        const proxy = watchedProxyFacade.getProxyFor(orig);

        const anotherObj = {prop: "another"};
        proxy.setSomeObj(anotherObj);
        utils.expectNonProxy(orig.someObj);
        utils.expectProxy(proxy.someObj);

        proxy.setSomeObj(watchedProxyFacade.getProxyFor(anotherObj));
        utils.expectNonProxy(orig.someObj);
        utils.expectProxy(proxy.someObj);
    })

    test("Proxies with Set", () => {
        const watchedProxyFacade = new WatchedProxyFacade();
        const utils = new WgUtil(watchedProxyFacade);

        const origSet = new Set<object>();
        const proxyedSet = watchedProxyFacade.getProxyFor(origSet);

        const storedObjOrig = {some: "value"};
        const storedObjectProxy = watchedProxyFacade.getProxyFor(storedObjOrig);
        proxyedSet.add(storedObjectProxy);
        utils.expectNonProxy(origSet.keys().next().value!);
        utils.expectNonProxy(origSet.values().next().value!);
        utils.expectProxy(proxyedSet.values().next().value!);
        utils.expectProxy(proxyedSet.entries().next().value![1]);
        utils.expectProxy([...proxyedSet][0]);

        expect(proxyedSet.has(storedObjectProxy)).toBeTruthy()
        //expect(proxyedSet.has(storedObjOrig)).toBeFalsy(); // may still work

        proxyedSet.forEach((value, key, set) => {
            utils.expectNonProxy(this as any as object);
            utils.expectProxy(value);
            utils.expectProxy(key);
            utils.expectProxy(set);
        },{})

        // TODO: baseline 2024 methods (intersection, ...)


        // ** deleting the value ***
        //proxyedSet.delete(storedObjOrig) // may work
        //expect(origSet.size).toEqual(1);
        origSet.delete(storedObjectProxy) // Should not work
        expect(origSet.size).toEqual(1);
        proxyedSet.delete(storedObjectProxy) // Should work
        expect(origSet.size).toEqual(0);
    })

    test("Proxies with Map", () => {
        const watchedProxyFacade = new WatchedProxyFacade();
        const utils = new WgUtil(watchedProxyFacade);

        const origMap = new Map<object,object>();
        const proxyedMap = watchedProxyFacade.getProxyFor(origMap);

        const origValue = {some: "value"};
        const valueProxy = watchedProxyFacade.getProxyFor(origValue);

        const origKey = {some: "theKey"};
        const keyProxy = watchedProxyFacade.getProxyFor(origKey);

        proxyedMap.set(origKey, origValue);
        utils.expectNonProxy(origMap.keys().next().value!);
        utils.expectNonProxy(origMap.values().next().value!);
        expect(origMap.has(origKey)).toBeTruthy();
        expect(origMap.has(keyProxy)).toBeFalsy();
        expect(proxyedMap.has(keyProxy)).toBeTruthy();
        utils.expectProxy(proxyedMap.get(keyProxy)!);

        utils.expectProxy([...proxyedMap.values()][0]);
        utils.expectProxy([...proxyedMap.keys()][0]);
        utils.expectProxy(proxyedMap.entries().next().value![0]);
        utils.expectProxy(proxyedMap.entries().next().value![1]);
        proxyedMap.forEach((value, key, map) => {
            utils.expectNonProxy(this as any as object);
            utils.expectProxy(value);
            utils.expectProxy(key);
            utils.expectProxy(map);
        })
        utils.expectProxy([...proxyedMap][0][0]); // First key
        utils.expectProxy([...proxyedMap][0][1]); // first value


        // ** deleting the value ***
        //proxyedMap.delete(origKey) // may work
        //expect(origMap.size).toEqual(1);
        origMap.delete(keyProxy) // Should not work
        expect(origMap.size).toEqual(1);
        proxyedMap.delete(keyProxy) // Should work
        expect(origMap.size).toEqual(0);

    })
});

describe("PartialGraph#onAfterChange", () => {
    test("ProxyFacade#onAfterChange's listeners should be called", () => {
        const orig = {
            users: [{id: 0, name: "Heini"}]
        } as any
        const proxyFacade = new WatchedProxyFacade();
        let called = 0;
        const changeHandler = vitest.fn(() => called++)
        proxyFacade.onAfterChange(changeHandler);
        const proxy = proxyFacade.getProxyFor(orig);

        proxy.someField = true;
        expect(called).toEqual(1);

        called = 0;
        proxy.users.push({});
        expect(called).toBe(1); // Might be even more

    });

    /**
     * Quick theoretical use case. Not really a good regression test.
     */
    test("Proxyfacade to track objects in an imaginary react component", () => {
        const orig = {
            form: {
                name: "",
                address: ""
            }
        }
        const watchedCompProxyFacade = new WatchedProxyFacade();
        let wc_onAfterChange_calledTimes = 0;
        watchedCompProxyFacade.onAfterChange(() => wc_onAfterChange_calledTimes++);
        const wcProxy = watchedCompProxyFacade.getProxyFor(orig);

        const facadeForChild = new WatchedProxyFacade();
        let facadeForChild_onChange_onAfterChange_calledTimes = 0;
        facadeForChild.onAfterChange(()=> facadeForChild_onChange_onAfterChange_calledTimes++)

        wcProxy.form = {name: "loadedInitial", address: "loadedAddress"};
        expect(wc_onAfterChange_calledTimes).toEqual(1);
        expect(facadeForChild_onChange_onAfterChange_calledTimes).toEqual(0); // this should not be called

        wc_onAfterChange_calledTimes = 0;
        facadeForChild_onChange_onAfterChange_calledTimes=0
        const proxyToPassToChild = facadeForChild.getProxyFor(wcProxy.form);

        // if the child is a **watchedComponent**, it makes a proxy layer again:
        const proxyUsedInChild = watchedCompProxyFacade.getProxyFor(proxyToPassToChild);
        expect(proxyUsedInChild !== wcProxy.form).toBeTruthy();

        proxyUsedInChild.name="changed";
        expect(wc_onAfterChange_calledTimes).toEqual(1);
        expect(facadeForChild_onChange_onAfterChange_calledTimes).toEqual(1);

    });

    test("changeTrackedOrigObjects#onChange's listeners should be called", ()=> {
        const orig = {} as any
        installChangeTracker(orig);
        const changeHandler = vitest.fn(() => {
            const i = 0; // set breakpoint here
        })
        changeTrackedOrigObjects.onAfterChange(changeHandler);
        orig.someField = true;
        expect(changeHandler).toBeCalledTimes(1);

    });


})

describe("Iterators", () => {
    // Mostly already tested by the "Returning proxies" tests
    test("Iterators with return should not error", () => {
        const orig = [{t:"a"}, {t:"b"}, {t:"c"}];
        const watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(orig);
        for(const o of proxy.values()) {
            break;
        }
        const iterator = proxy.values();
        iterator.next();
        //iterator.return!(); // Ok, seems like there is no return method available, so this test is useless
    });
});

function fnToString(fn: (...args: any[]) => unknown) {
    return fn.toString().replace(/\s+/g," ").toString();
}

function enhanceWithChangeTrackerDeep(obj: object) {
    visitReplace(obj, (value, visitChilds, context) => {
        if(isObject(value)) {
            installChangeTracker(value);
        }
        return visitChilds(value, context)
    })
}

/**
 * Test, if writerFn behaves normal when used through the watchedProxyFacade, etc.
 * @param name
 * @param provideTestSetup
 */
function testWriterConsitency<T extends object>(provideTestSetup: () => {origObj: T, writerFn: (obj: T) => void}, name?: string) {
    for (const mode of ["With writes through WatchedProxyFacade proxy", "With writes through installed write tracker"]) {
        test(`WriterFn ${name || fnToString(provideTestSetup().writerFn)} should behave normally. ${mode}`, () => {
            const origForCompareTestSetup = provideTestSetup();
            origForCompareTestSetup.writerFn(origForCompareTestSetup.origObj);

            if (mode === "With writes through WatchedProxyFacade proxy") {
                const testSetup = provideTestSetup();
                const proxy = new WatchedProxyFacade().getProxyFor(testSetup.origObj)
                testSetup.writerFn(proxy);
                expect(_.isEqual(proxy, origForCompareTestSetup.origObj)).toBeTruthy();
                expect(_.isEqual(testSetup.origObj, origForCompareTestSetup.origObj)).toBeTruthy();
            } else if (mode === "With writes through installed write tracker") {
                const testSetup = provideTestSetup();
                const proxy = new WatchedProxyFacade().getProxyFor(testSetup.origObj);
                enhanceWithChangeTrackerDeep(testSetup.origObj);
                testSetup.writerFn(testSetup.origObj);
                expect(_.isEqual(proxy, origForCompareTestSetup.origObj)).toBeTruthy();
                expect(_.isEqual(testSetup.origObj, origForCompareTestSetup.origObj)).toBeTruthy();
            }
        });
    }
}


const testPartialGraph_onchange_withFriterFn_alreadyHandled = new Set<(obj: any) => void>();
function testPartialGraph_onchange_withFriterFn<T extends object>(provideTestSetup: () => {origObj: T, writerFn: (obj: T) => void}) {
    const testSetup = provideTestSetup()

    if(testPartialGraph_onchange_withFriterFn_alreadyHandled.has(testSetup.writerFn)) { // Already handled?
        return;
    }
    testPartialGraph_onchange_withFriterFn_alreadyHandled.add(testSetup.writerFn);

    test(`${fnToString(testSetup.writerFn)}: PartialGraph#onChanged should be called`, () => {
        let watchedProxyFacade = new WatchedProxyFacade();
        const proxy = watchedProxyFacade.getProxyFor(testSetup.origObj);
        const changeHandler = vitest.fn(() => {
            const i = 0; // set breakpoint here
        });
        watchedProxyFacade.onAfterChange(changeHandler);
        testSetup.writerFn!(proxy);
        expect(changeHandler).toBeCalledTimes(1); // writerFn may be not written with "no more than 1 change restriction" in mind.
    });
}
