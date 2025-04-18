// ****  See the function common.ts#checkEsRuntimeBehaviour ***

// Array:
outputExpecterCode(["a"], (v) => v.at(0))
outputExpecterCode(["a", "b", "c"], (v) => v.concat("d","e","f"));
outputExpecterCode(["a", "b", "c"], (v) => v.map(x => read(x)));
outputExpecterCode(["a", "b", "c"], (v) => v.forEach(x => read(x)));
outputExpecterCode(["a", "b", "c"], (v) => v.join(","));
//outputExpecterCode(["a", "b", "c"], (v) => v.keys());
//outputExpecterCode(["a", "b", "c"], (v) => v.values());
outputExpecterCode(["a", "b", "c","d"], (v) => v.slice(1,3));
outputExpecterCode(["a", "b", "c"], (v) => v.some( x => x ==="a"));
outputExpecterCode(["a", "b", "c"], (v) => v.filter(x => x === "a"));
outputExpecterCode(["a", "b", "c"], (v) => v.find(x => x === "a"));
//outputExpecterCode(["a", "b", "c"], (v) => v.entries());
outputExpecterCode(["a", "b", "c"], (v) => v.every(x => x ==="a"));
outputExpecterCode(["a", "b", "c"], (v) => v.findIndex(x => x ==="a"));
outputExpecterCode(["a", "b", "c"], (v) => v.includes("b",1));
outputExpecterCode(["a", "b", "c"], (v) => v.indexOf("b", 1));
outputExpecterCode(["a","b","c"], (v) => v[Symbol.iterator]().next());
outputExpecterCode(["a", "b", "b"], (v) => v.lastIndexOf("b", 1));
outputExpecterCode(["a", "b", "b"], (v) => v.reduce((p, c ) => p + c));
outputExpecterCode(["a", "b", "b"], (v) => v.reduceRight((p, c) => p + c));
outputExpecterCode(["a", "b", "b"], (v) => v.toLocaleString());
outputExpecterCode(["a", "b", "b"], (v) => v.toString());
outputExpecterCode(["a", "b", "c"], (v) => v.unshift("_a","_b"));
outputExpecterCode(["a", "b", "c","d"], v => v.splice(1,2, "newB", "newC", "newX"))
outputExpecterCode(["a", "b", "c","d"], v => v.copyWithin(3, 1,3))
outputExpecterCode(["a", "b", "c","d"], v => v.reverse());

// Iterator
console.log("if([].values().forEach) { // Runtime supports these iterator functions like forEach, filter, .... ")
outputExpecterCode(() => ["a", "b", "c"][Symbol.iterator](), it => it.forEach(x => x))
outputExpecterCode(() => ["a", "b", "c"][Symbol.iterator](), it => it.filter(x => x === "b"))
outputExpecterCode(() => ["a", "b", "c"][Symbol.iterator](), it => it.take(2));
outputExpecterCode(() => ["a", "b", "c"][Symbol.iterator](), it => it.toArray());
console.log("}")

// Set:
//outputExpecterCode(new Set<string>(["a","b","c"]), v => v.forEach(i => read(i))) // TypeError: Method Set.prototype.forEach called on incompatible receiver #<Set>
//outputExpecterCode(new Set<string>(["a","b","c"]), v => v.intersection(new Set<string>(["b","c","e"]))) // TypeError: Method Set.prototype.intersection called on incompatible receiver #<Set>



/**
 *
 */
function outputExpecterCode<T extends object>(orig: T | (() => T), fn: (proxy: T) =>  void ) {
    let origJS = JSON.stringify(orig);
    if(typeof orig === "function") {
        origJS = orig.toString().replace(/\s+/g," ").replace(/^\(\)=>/,"").toString()
        orig = orig();
    }
    const usedFields = new Set<string | symbol>();
    const proxy = new Proxy(orig, {
        get(target: T, p: string | symbol, receiver: any): any {
            usedFields.add(p)

            if(p === "next") {
                //@ts-ignore
                return (...args: unknown[]) => target.next(...args); // .next() method must run on target, not on proxy
            }

            //@ts-ignore
            return target[p];
        }
    })
    read(fn(proxy));
    console.log(`//@ts-ignore`)
    console.log(`expectUsingMethodsOrFields(${origJS}, ${fnToString(fn)}, [${[...usedFields.values()].map(f => typeof f === "string"?`"${f}"`:`${f.toString().replace(/(^Symbol\()|(\)$)/g,"")}`). join(",")}])`)

    function fnToString(fn: (...args: any[]) => unknown) {
        return fn.toString().replace(/\s+/g," ").toString();
    }
}

/**
 * Just do something the runtime can't optimize away
 * @param value
 */
function read(value: any) {
    if( ("" + value) == "blaaxyxzzzsdf" ) {
        throw new Error("should never get here")
    }
}

