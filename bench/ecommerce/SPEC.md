# E-commerce MVP

The same spec for every builder. A small shop: browse products, open one, keep a cart, check out, see the order
confirmed. No real payments and no backend: products come from the fixture file, the cart lives in the browser
(localStorage), and placing an order calls a mock order service in the app (no network).

Stack (already in the starter): Next.js app router, React 18, Tailwind CSS, base components on Radix UI primitives
(Button, TextField, Card, Dialog, Select, Checkbox, Toast) and base pages (ListPage, DetailPage, FormPage). Products:
the fixture file with 12 products in 3 categories (Clothing, Home, Electronics), 4 each (Line arm:
`library/fixtures/products.json`; plain arm: `lib/products.json`). Prices are shown in US dollars with two decimals,
for example `$48.00`.

Routes (the acceptance tests open these URLs):

| Route | Feature | Page |
| --- | --- | --- |
| `/` | catalog | the product list |
| `/products/<id>` | product | one product (`<id>` is the fixture id, e.g. `ceramic-mug`) |
| `/cart` | cart | the cart |
| `/checkout` | checkout | the checkout form |
| `/order/confirmation` | checkout | the order confirmation |

Each feature section below is a Line `spec.md` (`packages/engine/line/featureText.mjs` format): the `##` line is the
feature's story and each numbered item is one acceptance point. The acceptance tests in `acceptance/` check each point
by its id (for example `CAT-2`), using roles and labels only.

## As a shopper, I want to browse and search the products, so that I can find one to buy (feature `catalog`)

1. CAT-1: The page at `/` has the main heading "Products" and lists all 12 products, each with its name, its category and its price (like `$48.00`).
2. CAT-2: A filter labelled "Category" offers All, Clothing, Home and Electronics; choosing a category shows only its 4 products, and All shows all 12 again.
3. CAT-3: A search box labelled "Search" filters the list by product name as you type, ignoring case ("mug" shows only Ceramic Mug), and it combines with the category filter.
4. CAT-4: When no product matches, the page says "No products found".
5. CAT-5: Each product's name is a link to its page at `/products/<id>`.

## As a shopper, I want to see one product and add it to my cart, so that I can decide and buy it (feature `product`)

1. PROD-1: The page at `/products/<id>` has the product's name as its main heading and shows its category, its description and its price.
2. PROD-2: A field labelled "Quantity" (default 1, at least 1) and an "Add to cart" button add that many of the product to the cart, and a status message says "Added to cart".
3. PROD-3: An unknown id shows "Product not found" and a link back to the products.
4. PROD-4: A link "Back to products" returns to `/`.

## As a shopper, I want a cart I can change, so that I buy exactly what I want (feature `cart`)

1. CART-1: Every page shows a link whose name starts with "Cart" and shows the number of items in the cart, like "Cart (3)"; it opens `/cart`.
2. CART-2: The page at `/cart` has the main heading "Your cart" and lists each product in it with its name, its unit price, a quantity field labelled "Quantity for <product name>" and its line total.
3. CART-3: Changing a quantity updates the line total, the subtotal, the total and the item count; a quantity of 0 removes the line.
4. CART-4: A button "Remove <product name>" removes that line.
5. CART-5: The cart shows "Subtotal", "Shipping" and "Total": shipping is $5.00, or $0.00 when the subtotal is $100.00 or more, and the total is the subtotal plus shipping.
6. CART-6: An empty cart says "Your cart is empty" and offers no checkout.
7. CART-7: The cart is kept after the page is reloaded.
8. CART-8: A "Checkout" link or button opens `/checkout`.

## As a shopper, I want to check out and see my order confirmed, so that I know my order was placed (feature `checkout`)

1. CHK-1: The page at `/checkout` has the main heading "Checkout" and fields labelled "Full name", "Email", "Address", "City" and "Postal code", and a checkbox labelled "I accept the terms".
2. CHK-2: Submitting with an empty or invalid field places no order and shows a message for each invalid field ("Full name is required", "Enter a valid email", "Postal code must be 5 digits", "Accept the terms to continue"); each invalid field is marked invalid (aria-invalid).
3. CHK-3: The checkout page shows an order summary with each product, its quantity and the order total.
4. CHK-4: With every field valid, the "Place order" button places the order through a mock order service, empties the cart and opens `/order/confirmation`.
5. CHK-5: The confirmation page has the main heading "Thank you for your order" and shows the order number (text starting "Order #"), the products bought and the total paid, with a link "Continue shopping" to `/`.
6. CHK-6: Opening `/checkout` with an empty cart says "Your cart is empty" with a link to the products, instead of the form.
