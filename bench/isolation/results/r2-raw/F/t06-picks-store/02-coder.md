```ts
import { listPicks, addPick, removePick } from './picksStore';

// Example usage
addPick("book1");
addPick("book2");
console.log(listPicks()); // Output: ["book1", "book2"]
removePick("book1");
console.log(listPicks()); // Output: ["book2"]
```