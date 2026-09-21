One example from start to finish: a wishlist for a small shop. You sign in, open the project, write the ticket, see what it reaches, choose which model may help, create the feature, let a local model write its code, look at the real page, see the running app full screen, add logic through a workflow, and check the rules. It runs about three and three-quarter minutes, with captions and no sound.

![Video: build a feature, start to finish, in the Cockpit](@video/01-ticket-to-story)

## What you will see

1. Sign in. Only accounts the owner allowed get in. (This recording uses the demo login.)
2. Open the sample shop. It has three features: catalog, cart and checkout.
3. Choose the models in **Settings**: the fill-in work can go to a local model, and the plan analysis never does.
4. Write the ticket in the **Notes** tab: *Let shoppers save a product from the catalog for later, and see the saved products on their own page.*
5. Ask the Cockpit which parts it touches and confirm its guess. Read the impact, worked out from your code with no AI model.
6. Build the plan: a read step, a step that creates the feature, and a step that creates its layers with the **Local model** tag. The plan says before it runs that a model is used.
7. Do the work from the Features screen. First the mechanical way: create the `wishlist` feature, with zero model calls. Then create a slice (domain, component, page, controller) with the local model box ticked, so the model writes the code. One hand-written route file then hooks the page up to `/wishlist`.
8. Open the **Pages** screen: the page the model wrote and its tree of elements.
9. Point the preview at the running shop's `/wishlist` and go full screen. Use the generated app for real: add two products, remove one, remove the last and see the empty state. Then leave full screen.
10. Open the checkout **workflow**, add a way back after a rejected order, and read the exact change before it is written.
11. Check the rules: no errors, and two real warnings on the new feature (a missing one-line summary, and a controller not yet exported from its index).

## The captions

- Build a feature, start to finish. One example: a wishlist for a small shop
- First, sign in. Only accounts the owner allowed get in. (This recording uses the demo login.)
- Nothing is open yet. Let us try the sample shop.
- Here is the shop, with three features: catalog, cart and checkout.
- Before we start: which model may help? Fill-in work can go to a local model. The plan analysis never does.
- Saved. Today the model is chosen per kind of job, not yet per block. (This recording uses a stand-in for the local model, so every take is identical.)
- Now write the ticket, in plain words.
- Ask the Cockpit which parts of the shop it touches.
- It makes a guess. You confirm it before anything uses it.
- Here is what the change reaches: files and features. Worked out from your code, no AI model.
- It suggests a first step: read the catalog. Now add the real work.
- Step two: create the wishlist feature. A Construct block does it, no model.
- Step three: create its domain, component, page and controller, and let the local model write the code.
- The plan says before it runs that a model is used, and which one.
- That is the plan: a checklist, and nothing changes until something runs. Let us do the first steps by hand.
- First the mechanical way: create the feature. A Construct block, no model.
- Done in a blink, with zero model calls. The folders and stubs are there.
- Now the pages and logic. Create a slice: domain, component, page and controller.
- Tick the box to let the local model write the code. It is off unless you choose it, each time.
- Four files written by the model, and each one checked against the rules. (Stand-in model in this recording.)
- One hand-written line hooks the page up to the /wishlist address. The rest was generated.
- The Pages screen shows the real page the model wrote, and its tree of elements.
- Now the best part: open the wishlist in the running shop, at /wishlist.
- Full screen. This is the generated app, running for real.
- Add a product. It appears in the list.
- Add another one.
- Remove one. The list follows.
- Remove the last one: the empty state shows. It all works.
- Logic lives in workflows. This is the checkout flow, drawn from its real code.
- Add a way back: after a rejected order the shopper can start over.
- You see the exact change before it is written.
- Finally, the rules. No errors. Two warnings on the new feature: it needs a one-line summary, and its controller is not exported yet. Real findings, and quick fixes.
- One example, end to end. Next: review a branch, and run a test.

## Real and stand-in

Everything is the real Cockpit and the real commands, with two exceptions. Sign-in uses the demo login, because GitHub sign-in cannot be scripted. The local model is a small stand-in server that answers with fixed, small but working code for the four layers, so a re-recording gives the same video, and the wishlist you see running is that code. The one hand-written file is the `/wishlist` route that hands the page to the generated controller; a real local model answers in the same way, with code of its own.

## Good to know

Files from a plan run are approved one by one in the Processes drawer, and only if the plan lists them; the Plan screen cannot list files yet, so this video creates the feature from the Features screen instead. The [plan, run and approve example](@user-guide/examples/cockpit-plan-and-run/) has the approval screens. The model is chosen per kind of job in Settings, and per plan step by its tag; a model choice for each individual block is not built yet.
