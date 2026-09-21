# Operator guide

This is the app from your side of the counter. No code, no jargon — just the
daily routine, what each button does to your shop, and what to do when something
looks wrong.

If you only read one section, read **The things that catch people out**.

---

## What this app is, and what it is not

It is a **reservation book**. It takes a customer's name and Instagram handle,
reserves the pieces they ask for, and stops you selling the same shirt twice —
because it counts what is left and refuses the order that would go over.

It is not a shop. Specifically:

- **No money moves through it.** No card form, no receipt upload, no payment
  gateway. Customers pay you in DM, as they already do.
- **It does not message anyone.** There is no email, no SMS and no push
  notification, by design. The dashboard's list of things to do *is* the
  notification system. If you do not open it, you will not find out.
- **It does not know a customer paid.** You tell it, with the Paid switch on the
  order. It only records what you already know.

Everything else — who ordered, how many, which drop, whether it has been paid,
which supplier run it is in — it does properly.

---

## Before your first drop

Work through this once. It takes about ten minutes and covers almost every
question you will have later.

1. **Sign in** at `/admin/login`. The account exists already — it was created
   when the app was set up, and its password was shown once, at that moment. If
   you do not have it, see *"I cannot get in"* below.
2. **Change that password.** Go to **Account** in the sidebar (👤) and use at
   least 12 characters. Until you change it, whoever set the app up may still
   know it.
3. **Check the Instagram handle.** The account customers are told to message
   comes from the app's configuration (`NEXT_PUBLIC_INSTAGRAM_HANDLE`). If it is
   still a placeholder, every "message us on Instagram" line in the app is
   telling customers the wrong thing. Whoever set the app up changes it — see
   `docs/DEPLOYMENT.md`.
4. **Create a batch.** A batch (📦 **Batches**) is one supplier run: the wave of
   pre-orders you place together and receive together. Nothing can be ordered
   until a product is in one.
5. **Create your products** (👗 **Products**). For each one you set the price,
   the sizes, the colours, and **how many you can take**. Note that a new
   product gets one image at creation; more images can be added later by editing
   the product.
6. **Decide your checkout questions** (⚙️ **Settings**). Customers are always
   asked for their full name and Instagram username. Anything else you want —
   phone number, address, a note — you add here, without anyone changing code.
7. **Look at the storefront the way a customer would.** Add something to the
   cart and place one real order, then cancel it. It is the only way to see what
   your customers see.

---

## Setting what you can take

This is the most important thing on the Products screen, and the one most likely
to be skipped.

Pre-orders cannot oversell — but only for the pieces the app has been told
about. A stock box left empty means **no limit**, and the app will accept a
hundred orders for it. So:

- **Sizes** and **Colours** are plain lists separated by commas: `S, M, L, XL`
  and `Black, White`. Every colour is paired with every size, so those two lines
  make eight options.
- Underneath, the app shows **one row per option with its own box**. Type how
  many of that exact option you can get.
- If every option gets the same number, type it once in the small box above the
  rows and press **Give every option this many**.
- **Total for this product** is an extra cap across all the options together.
  Useful when your supplier gives you "fifty pieces of these, whatever mix".

Two rules worth knowing:

- **A number can never be set below what has already been ordered.** If three
  Black / M are already reserved, the smallest number that box will accept is 3.
  The app is stopping you from creating a state where the books do not add up.
- **Changing a number does not refill stock.** Raising a limit from 10 to 20 adds
  ten more available pieces; it does not forget the ones already sold.

Each row shows what is left — "8 left of 30 — 22 already ordered" — so you can
see the effect of your orders before you decide.

---

## During a drop

### The dashboard is your to-do list

Open it first, every time. It leads with three things that need a decision:

| What it says | What it means |
| --- | --- |
| Orders awaiting your approval | New reservations nobody has looked at yet. |
| First-time customers who have not paid | First-timers usually need the payment conversation; a regular often does not. |
| Unpaid orders | Everything still waiting for money. |

Each one is a link into the order list, already filtered. Below that are the
counts (orders today, pending, confirmed, revenue) and any **batches due** soon —
your cue to tell waiting customers when their pieces will arrive.

### The order list

📋 **Orders** is one queue with every order in it.

- **Search** by order number, customer name or Instagram handle.
- **Status** narrows it to one stage.
- The **filters live in the address bar**, so what you are looking at can be
  bookmarked or sent to yourself. **Clear filters** empties them.
- **Export CSV** downloads exactly what you are looking at, filters and all.
  That is the file to send a supplier or open in a spreadsheet.

Each row shows the order number, the customer with a **NEW** or **OG** badge
(first order, or has ordered before), the drop, how many pieces, the total, and
whether it is paid.

### One order

Open an order and you get the whole story: what they ordered, what they answered
on the checkout form, their details, and the history of who changed what and
when. Three things you can do:

- **Status.** Only the moves that make sense from where the order is are
  offered. A new order is `PENDING`, and a normal life is
  `PENDING → CONFIRMED → PROCESSING → READY → SHIPPED → COMPLETED`.
  **Cancelling or rejecting an order returns its pieces to your stock** — that is
  the only thing that does.
- **Paid / Unpaid.** One switch. Flip it when the money is actually in. It never
  moves the order's status; the two are kept apart on purpose, because "I have
  been paid" and "the shirt has arrived" are different facts.
- **Batch.** Which supplier run the order belongs to. Changing it moves the
  order, and says who moved it in the history.

---

## After a drop

1. **Close the products.** Set each one's **Pre-Order Status** to *Closed* or
   *Sold Out* on the Products screen; *Disabled* hides it from customers
   entirely. The order service refuses anything that is not *Open*, so this is
   what actually stops new orders — not deleting anything.
2. **Put the orders in a batch** (📦 **Batches**) so they are one supplier run.
3. **Set the batch ETA** (📦 **Batches** → *Expected*). One date does two jobs:
   customers see it as **Closes 30/09/2026** on the storefront, and once it has
   passed, the drop leaves the storefront and the checkout refuses new orders
   with "This pre-order batch has ended." The dashboard warns you as the date
   approaches. Set it even when the date is a guess — a drop with no date takes
   orders forever, and nothing tells you that it is still doing so.
4. **Move orders along** as the run progresses: `PROCESSING` while the supplier
   has them, `READY` when they land, `SHIPPED` when they leave, `COMPLETED` when
   they arrive. Customers following their link see each change explained in plain
   words.
5. **Export the CSV**, for the supplier and for your own records.

**Never delete an order to fix a mistake.** Cancel it instead: cancelling keeps
the history and returns the stock, while deleting would leave a hole in the
books.

---

## The things that catch people out

**"A size disappeared from my shop."**
Taking a size or a colour out of the two list boxes **retires** those options:
they stop being orderable and leave the storefront. The app warns you with the
exact list before it saves, and every past order keeps what it had. Type the size
or colour back in and the option returns, with the stock it was holding.

**"It will not let me set the stock that low."**
You are trying to go below what customers have already reserved — the number has
to cover them. Cancel or reject the orders you are not honouring, which returns
their pieces, and then lower the number.

**"My drop shows on the site but will not accept orders."**
Three things have to line up: the product's **Pre-Order Status** must be *Open*,
its **Active** box must be ticked, and it has to be in a batch. Any one of them
being off gets exactly this behaviour — visible, refusing.

**"An order I know about is not in the list."**
Look at the address bar. Filters stay in the URL, so a filtered list can be
bookmarked and come back to days later. Press **Clear filters** and it will all
be there.

**"My stock never runs out."**
That option's stock box is empty, and empty means no limit. This is the most
common cause of the overselling the app cannot prevent, because it was never told
the number.

**"I cannot get in."**
There is no "forgot my password" email, because this app sends no mail at all.
Somebody who can reach the machine the app runs on resets it with one command:

```
npm run admin:create -- --email you@example.com --reset-password
```

It prints a new password once, and never asks for the old one, which is the whole
point. Use `--password "a new password"` instead if you would rather choose it —
just remember that whatever you type into a shell stays in that shell's history.
The command must be run by whoever set the app up (or whoever has the server's
password) — see `docs/DEPLOYMENT.md`.

**"I cannot add a second staff account."**
There is no invite screen: accounts are created for the machine the app runs on,
by the same person and with the same command, which also sets what the account is
allowed to do:

```
npm run admin:create -- --email ana@example.com --name Ana --role ORDER_MANAGER
```

Ask whoever set the app up. Roles are listed in `docs/DEPLOYMENT.md`; a
`VIEWER` account can look at everything and change nothing.

---

## Things that are true and surprising

- **The Instagram handle is the customer.** Two customers with the same handle
  are one person to this app, and two people sharing one account cannot be told
  apart. Handles are stored normalised, so `@JuanDC` and `juandc` are the same
  customer — which is exactly what makes two people both called Juan dela Cruz
  distinguishable.
- **An order keeps a copy of what the customer saw.** Renaming a product or a
  checkout question never rewrites what an old order says.
- **Cancelling is undoable. Deleting is not.** Orders are never deleted.
- **A session lasts eight hours.** Being signed out mid-drop is normal, and
  signing a device out from somewhere else is not something this app can do.
- **There is no notification.** Nobody will be told about an order but you, and
  only if you open the dashboard.
- **The app will not guess a number for you.** Anywhere a limit is blank it means
  unlimited, not "I will decide later".

---

## The words the app uses

| Word | What it means here |
| --- | --- |
| Batch / Drop | One supplier run. The pieces are ordered together and arrive together. |
| Variant / Option | One exact combination of colour and size. `Black / M` is a variant. |
| Capacity | How many of one variant you can take. Blank means no limit. |
| Pre-order limit | A cap across every variant of one product, on top of each variant's capacity. |
| Retired | An option taken off the storefront without being deleted. Past orders keep it. |
| ETA | The date you expect a batch to arrive. It is also the date the drop stops taking orders, and customers see it as **Closes …** on the storefront. |
| OG / NEW | This customer has ordered before, or this is their first order. |
