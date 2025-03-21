# Developing
### Prepare

```bash
git clone https://github.com/bogeeee/proxy-facades.git
cd proxy-facades
npm install --ignore-scripts
```


### Run the tests
from inside the project dir:
```bash
npm run test
```

### Diving into the code

#### File organization
I tried to spread code into multiple files as much as possible, but because of so much cross dependencies it all drifted again to beeing placed in one large file: `proxyFaccade.ts`

#### General
First of all, you have to keep in mind, when understanding the code, that this library **serves both use cases**: Tracking changes through proxies and tracking changes on the original object (="track origina mode", which  is a nice to have feature, used in react-deepwatch).
#### Read/change- tracker classes
To make the devlopment of tracking code for certain JS classes, like, i.e. a `Set` easier, 
there is concept of Read/change- tracker classes, where you override methods and call the hooks as much natural as possible.
Those "classes" are not really classes, where instances get created from, but their code (methods and property accessors) is used.
It is split into ReadTracker and ChangeTracker parts, because the track-original mode only needs the ChangeTracker

Example from: [class-trackers/Set.ts](class-trackers/Set.ts)
````typescript
export class SetChangeTracker<T> extends Set<T> {
    // ...
    
    add(value:T): this {
        value = this._watchedProxyHandler?this._watchedProxyHandler.getFacade().getUnproxiedValue(value):value; // Translate to unproxied value (only if we are running in proxied mode)

        if(this._target.has(value)) { // No change? It's always important to filter these out and not fire a change operation.
            return this;
        }
        
        // wrap in runChangeOperation, to call all listeners on this change ONLY ONCE.
        runChangeOperation(this, new UnspecificObjectChange(this),[
            // These change hooks are served:
            getChangeHooksForSet(this).afterSpecificValueChanged.get(value), 
            getChangeHooksForSet(this).afterAnyValueChanged
        ],() => {
            // Do the change:
            dualUseTracker_callOrigMethodOnTarget(this, "add", [value]); // like super.add(value)
        });
        
        return this;
    }
}
````

#### Change hooks
As seen in the above code, Set#add serves the `afterSpecificValueChanged` and `afterAnyValueChanged`.
For the [Watch for changes of precisely those values, that you've read before](readme.md#watch-for-changes-of-precisely-those-values-that-youve-read-before) use case,
in the recording phase, a `mySet.has("myValue")` call fired a `RecordedSet_has` Read:
````typescript
export class RecordedSet_has extends RecordedReadOnProxiedObjectExt {
    //...
    
    getAffectingChangeHooks(target: this["obj"]) {
        return [
            getChangeHooksForSet(target).afterSpecificValueChanged.get(this.value),
            getChangeHooksForObject(target).unspecificChange
        ];
    }
}
````
This one is interested in the `afterSpecificValueChanged.get("myValue")` and in the `unspecificChange` hooks.
The SetChangeTracker serves/fires the `afterSpecificValueChanged.get("myValue")` so we have an overlap here, and the change notification for the user works :)
Note that `runChangeOperation` additionally adds (fires) some default hooks.

The file `Set.ts` manages the Set-specific hook associations (by a weak-map) to the target objects itself, see the `getChangeHooksForSet` function and further.
The target objects means: The proxy, when used in a proxy facade, or the original when used in track-original mode.

This way, you can easily write a plugin for your own JS structure and have it all in one file. Just register it's config.

#### ProxyFacade classes
These classes always come as a pair:
- `ProxyFacade` and `FacadeProxyHandler`
- `WatchedProxyFacade` and `WatchedProxyHandler`

#### Futher notes
- Javascript's Array implementation has a lot of high-level methods where you give the native method a proxied `this` and it will i.e. call `.length`, `[0]`, `[1]` etc. on it
while Sets and Maps mainly have low level methods that need `this` as original.
- For track-original mode of existing objects and arrays the prototype is set to the a tracker object, which is a Proxy. Existing properties (and so the array contents) are still in the way and access woúld not reach the prototype, so they have to be replaced with traps, to make them trackable. 
Read the `installChangeTracker(...)` function as a good starting point to understand the track-original mode.