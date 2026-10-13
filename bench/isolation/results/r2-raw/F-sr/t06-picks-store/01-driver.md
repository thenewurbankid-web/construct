**FUNCTION:** `listPicks`, `addPick`, `removePick`

**SIGNATURE:**
```ts
listPicks(): string[];
addPick(id: string): void;
removePick(id: string): void;
```

**IMPORTS:** none

**CHANGE:**
- Add the following lines to the file:
  ```ts
  let picks: string[] = JSON.parse(localStorage.getItem("picks") || "[]");

  export function listPicks(): string[] {
    return picks;
  }

  export function addPick(id: string): void {
    if (!picks.includes(id)) {
      picks.push(id);
      localStorage.setItem("picks", JSON.stringify(picks));
    }
  }

  export function removePick(id: string): void {
    picks = picks.filter(pick => pick !== id);
    localStorage.setItem("picks", JSON.stringify(picks));
  }
  ```

**EXAMPLE:**
```ts
import { listPicks, addPick, removePick } from './picksStore';

// Example usage
addPick("book1");
addPick("book2");
console.log(listPicks()); // Output: ["book1", "book2"]
removePick("book1");
console.log(listPicks()); // Output: ["book2"]
```