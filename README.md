# Naija Hustle

A 3D Nigerian life sim for the web. Everyone starts level, with ₦250k, a rented room and the
same skills, and picks either a job or a starter business in a real Lagos, Kano or Rivers LGA.
You walk the street, work shifts, eat, gist, hire, expand, borrow, vote, and run for chairman,
governor and president.

A running economy ties it all together. Every leader's choices, yours included once you're in
office, move the naira, fuel, food, fares, rent and light. Those prices decide what every
trade, and every business, takes home.

## Run it

```sh
npm install
npm run dev      # http://localhost:5174
npm test         # engine, business, policy → outcome checks, and a 3-year soak
npm run build    # static site in dist/ (the 3D world is a separate, lazily loaded chunk)
```

Dev-only console helpers: `__nh.skip(weeks)` plays forward on routine; `__nh.office('LA')`
makes you governor so you can try the budget session.

Screenshots with the dev server running (uses the installed Edge): `node scripts/walk3d.mjs <url> <dir> desktop|mobile <state> <LGA nick>`
plays the opening; `node scripts/stages.mjs <url> <dir> <LGA id>` fills every plot with a business at
a different stage.

## Playing

- **The neighbourhood:** each LGA is a small town: a main road with a median and lamp posts,
  side streets on a grid, open gutters, a bus stop, a footbridge, billboards and a filling
  station showing today's petrol price. The places you use stand on plots along the roads,
  among houses, flats, churches, mosques, kiosks and abandoned buildings. Walk anywhere, or
  take a keke (an okada where it is not banned) for a small fare and no time. The minimap and
  the Places list take you straight to a place. Buildings between you and the camera sink out
  of the way.
- **Getting around Nigeria:** danfos to the other LGAs in your state leave from the bus stop.
  Long-distance buses to other states leave from the motor park, in the morning.
- **Time:** the clock runs. At normal speed a game minute passes every half second of real
  time, and you can pause or speed it up. Walking takes time. Actions take as long as they
  take: a shift at your stall is four hours, a day at the office eight, lunch at a buka forty
  minutes. Places keep opening hours (the bank 8–4, the joint till 2am). Shifts end at closing
  time. You wake at 6am if you were in bed before midnight. Stay up past 2am and you pass out
  wherever you are and wake late. Sunday settles the week.
- **Needs:** energy, food, social, health and mood wear down hour by hour. Eat at home or at a
  buka, gist with people, sleep. An early night gives back more energy than a late one.
- **A job or a business:** salaried jobs come with perks:
  - an HMO card, so the clinic and hospital are free;
  - a pension (10% of salary into your RSA);
  - depending on the job, a staff bus, a canteen lunch, a 13th-month bonus, a housing
    allowance, free data or a cheap staff loan.

  Government jobs lose their HMO when the state or council owes salaries. Running a business
  gives you none of this: you pay your own clinic bills. In return there is no ceiling, and
  staff earn for you every night.
- **Running costs:** besides wages, every business pays rent for its plot (more for a bigger
  building), power (the NEPA bill plus generator diesel, more when the grid is bad) and
  repairs and security, whether or not customers come. An empty shop loses money.
- **A living town:** your neighbours have savings and ambitions. They open shops on free
  plots with real-sounding names, hire each other, build up to two storeys or go bust, and look
  for work. A rival of the same kind on your streets takes some of your customers. You can eat
  at their buka, get your hair done at their salon, or offer to buy them out. People keep
  daily routines: they walk to work in the morning, go to the joint in the evening and go home
  at night.
- **What's on:**
  - Nollywood premieres, concerts, comedy nights, Super Eagles matches at the viewing
    centres, owambe parties, and the Eyo, Durbar and Bonny regatta festivals at their time of
    year.
  - You can go to them. Crowds also mean busy days for the bukas, bars, salons and transport
    in that LGA.
  - The phone's news app lists them, and the event centre's poster shows the next one.
- **The Naija Weekly:** Sunday's report carries a front page with the week's biggest stories,
  ranked: politics, prices, openings and closures, box office, scores, and your own week.
- **People:** tap anyone with a name tag to chat. What they say comes from the simulation:
  the okada ban, unpaid salaries, the price of rice. You can offer them a job if one of your
  businesses has an opening.
- **Plots:** every business stands on its own plot. Walk to a plot marked PLOT FOR LEASE and
  open a business there; farms and rice mills need farmland at the north edge of town. Okadas
  and kekes are vehicles, so you buy those at the motor park. As you build up a business, its
  building grows: zinc shack, container shop, block shop, two-storey building, big branded
  building with a rooftop sign, and a flagship complex. Bigger businesses start in a container
  shop rather than a shack. Yards fill with danfos, trucks, cement blocks or containers; farms
  add silos, a tractor and a barn. Once a business reaches two storeys it takes over the
  billboard at the end of the main road.
- **Businesses:** seven starter businesses (stall, POS, mama put, workshop, farm, okada,
  keke) grow into fifteen bigger ones:
  - consumer businesses: supermarket, restaurant, pharmacy, salon, private school, transport
    company, real estate;
  - suppliers: foodstuff wholesale, bakery, pure water, haulage, block industry, solar,
    clearing agency, rice mill.

  Suppliers earn from the sectors they serve. If you own a supplier and a business it feeds in
  the same state, that business buys 15% cheaper and the supplier gets busier. Staff are named
  people, and employing people builds influence. Bigger (formal) businesses pay wages tied to
  the minimum wage policy. Small starter businesses pay what the street pays: about half of
  what someone in that trade earns locally.
- **The phone** has bank alerts, your businesses' P&L, prices with charts, government, contacts,
  news and the map.

## How the world works

- `src/engine/` is pure TypeScript with no React, seeded and deterministic. Each exported
  function takes a `Game` and returns a new one, so the same code can later run on a server for
  multiplayer.
  - `economy.ts`: the naira, oil, fuel, food, fares, energy and rent each week; trade incomes
    and moods.
  - `government.ts`: FAAC sharing, IGR, wages, debt and budget lines each month; AI leader
    styles.
  - `business.ts`: business demand, P&L, staff, supply-chain links and valuation.
  - `life.ts`, `sim.ts`: actions by place and block, needs, nights, Sunday settlement.
  - `elections.ts`, `events.ts`, `talk.ts`.
  - `npc.ts`: everyone else's businesses and jobs. `culture.ts`: premieres, shows, matches and
    festivals. Both have their own random streams, so they do not change the dice for the rest of
    the world.
- `src/engine/map.ts`: the neighbourhood of each LGA as data: road grid, plots, which place or
  lot is on which plot, doors, and walking routes along the pavements. The rules use it to know
  which plots can be leased; the 3D world uses it to know where things stand.
- `src/world/`: the 3D town, built with react-three-fiber. `Town.tsx` has the roads, lamps,
  filler buildings, vacant plots, bus stop, footbridge and billboards. `BizBuildings.tsx` has your
  businesses at each stage. There are also regional building styles, people with walk cycles,
  traffic on every road, a danfo that stops at the bus stop, day/night light, rain and
  NEPA-dependent lamps. There are no external 3D assets: everything is built in code.
- `src/ui3d/`: HUD, action menu, chat card, phone. `src/ui/` has the shared panels and the
  modals (weekly report, events, budget session, election night).

## Liberties taken

- **Three states, sixteen LGAs.** Lagos, Kano and Rivers were chosen for three different
  economies. Each state's playable LGAs stand in for the whole state (their voters add up to the
  state's total).
- **Compressed time:** six playable days a week, four-week months, one-year terms (two-term
  limit). The game clock runs about 120 times faster than real time at normal speed.
- **Numbers are game figures** chosen to feel like 2026 Nigeria (₦1,500/$, petrol around ₦945, a
  50kg bag of rice around ₦78k, ₦70k minimum wage). They are not statistics.
- **People, parties and businesses are invented.** Places, landmarks, institutions and policies
  are real.
- **The central bank answers to the president**, and presidential elections are plurality wins.
- **No religion mechanics** and no ethnic modifiers.
- **The neighbourhoods are invented layouts.** Each LGA gets the same kind of grid town, three
  blocks by three, dressed in its region's style. The street plans do not copy any real street,
  and the LGA's real landmarks are named rather than modelled. Lagos main roads get BRT buses.
- **Side streets are laterite (red earth) until the council keeps the roads up** (road quality
  45 and above); potholes follow road quality too. Kano's old city and farm towns keep earth
  roads.
- **Invented culture:** films, stars, musicians and comedians are made up. The Super Eagles,
  the Eyo festival, the Kano Durbar and the Bonny regatta are real institutions, but the
  fixtures, results and crowds are simulated. Shop names follow how Nigerian shops are named
  (after the owner, or after a blessing like "Divine Favour").
- **Job perks are simplified:** every job of a kind has the same perks, the pension is a flat
  10% employer contribution, and small informal businesses are exempt from the minimum wage.
- **The town has limits:** at most six businesses per LGA run by other people, at least four
  street plots always left free for you, and about three dozen named people per LGA. Everyone
  else is in the economy's statistics.
- **Billboards are invented:** the governor's board carries a slogan for their leadership
  style, and the ads are for made-up brands.
- **Single-player for now.** Every business has an `owner` person id, so other players can be
  owners and employees later.

## Credits

State boundaries: [geoBoundaries](https://www.geoboundaries.org/) gbOpen NGA ADM1 (source:
GRID3), CC BY 4.0.
