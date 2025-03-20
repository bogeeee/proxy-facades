# Proxy facades for Javascript

## What are proxy facades?
A proxy is a wrapper for an (original) object that allows to track some things, like i.e. record all property-reads.
A proxy facade is, when that proxy also returns it's child objects wrapped in proxies, and those return their child objects wrapped too, and so on.
You're presented a virtual world, that looks and behaves just like the original one.

````typescript
const orig = {
    appName: "HelloApp",
    users: [
        {id: 1, name: "Bob", active: true},
        {id: 2, name: "Alice", active: false}
    ],
}

const facade = new SomeProxyFacadeSubclass(); // See WatchedProxyFacade example
const proxy = facade.getProxyFor(orig); // retrieve a proxy
console.log(proxy.appName); // Behaves like the original. Outputs: "HelloApp"

// Now retrieve a child-object:
const proxiedUser = proxy.users[0]; // Returns also a proxy
console.log(proxiedUser.name); // Behaves like the original. Outputs: "Bob"
````

This library proxies objects using the Javascript [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) class.

## What useful things can you do with it?

### Watch an object infinitely deep for changes
````javascript
import {WatchedProxyFacade} from "./watchedProxyFacade";

const orig = {
    users: [
        {id: 1, name: "Bob", active: true},
        {id: 2, name: "Alice", active: true}
    ],
}

const facade = new WatchedProxyFacade();
facade.onAfterChange((change) => console.log("something has changed!"))
const proxy = facade.getProxyFor(orig);

proxy.users[1].active=false; // Modify some deep value -> will log "something has changed!"
````

### Watch for changes of precisely those values, that you've read before
This variant of a proxy facade is used in [react-deepwatch](). With this, you have a hook for an event when some (deep) value changes of precisely the data, that was read by you.

This examples records all your **reads** and watches them for changes afterwards:

````typescript
import {WatchedProxyFacade, RecordedRead} from "./watchedProxyFacade";

const orig = {
    appName: "HelloApp",
    users: [
        {id: 1, name: "Bob", active: true},
        {id: 2, name: "Alice", active: true}
    ],
}

const facade = new WatchedProxyFacade();
facade.onAfterRead(((read: RecordedRead) => {
    read.onAfterChange( () => console.log("Something interesting was changed!"), true /* true=let's also track the original here;) */)
    // Also the read.equals(...) method might be handy, to check, if any of your preconditions have changed.
    // Also there are subclasses of RecordedRead: I.e. RecordedOwnKeysRead or RecordedArrayValuesRead
}))

const proxy = facade.getProxyFor(orig);

// <my reader code>
console.log(proxy.users[0].active); // Prints true (so far so good)
// </my reader code>

//facade.offAfterRead(...) // You should unregister the listener when your code-of-interest has finished

proxy.users[0].active = false; // Fires the event and prints: "Something interesting was changed!"
proxy.users[1].active = false; // Does NOT fire the event, cause <my reader code> is not interested in Alice!

// 👍👍👍Now comes another nice feature:
orig.users[0].active = true; // Also for **orig**, it fires the event and prints: "Something interesting was changed!". The trackOriginal parameter (above) has installed traps via prototype altering on orig, orig.users and orig.users[0] to track these objects too!
orig.users[1].active = true; // Again (also for orig), it does NOT fire the event, cause <my reader code> is not interested in Alice!

orig.users[0].name = "Bob_renamed"; // Also for orig, it does not fire the event, cause <my reader code> is not interested in the "name" field
````

### Other facade types (planned)
In the future, there will be a `TransactionProxyFacade`, where you can record you changes and commit them to the main memory at once, or roll them back.

Because proxy facades exploit all sorts of js tricks, it's good to have them all maintained in one package (here), so they can coordinate each other and don't crash, if different facade libraries are used on the same data.

## Supports
All usual Javascript structures:
Object properties, Arrays, Sets, Maps, Iterators (also tracks iterating with `Object.keys(...)`),
class instances (your methods will see `this` as a proxy), property accessors (=getters/setters - these are treated as whitebox, so the code **inside** them is tracked for reads/writes, just like your class's methods).  
You can also **layer** multiple proxy facades👍.

## Does not support
- Cloning proxied objects (if clone sets the same, shared prototype)
- Deleting properties with the `delete` operator. It cannot be tracked. Use the `deleteProperty` function therefore.
- Modifications on the prototype are not tracked (which is very unusual anyway).
- When your code alters the prototype chain.
- **Sub-** classes of `Array`, `Set` and `Map`. `WeakSet`, `WeakMap`, `WeakRef`. _Subclasses awareness may be implemented soon. Write me an isse if you need it._

## Install
_You've propably guessed it:_
````bash
npm install --save --ignore-scripts proxy-facades
````