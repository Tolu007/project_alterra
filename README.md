# Naija Hustle

A 3D Nigerian life sim for the web. Everyone starts level, with ₦250k, a rented room and the
same skills, and picks either a job or a starter business in a real Lagos, Kano or Rivers LGA.
You walk the street, work shifts, eat, gist, hire, expand, borrow, vote, and run for chairman,
governor and president.

A running economy ties it all together. Every leader's choices, yours included once you're in
office, move the naira, fuel, food, fares, rent and light. Those prices decide what every
trade, and every business, takes home.

There are two ways to play:
- **Online:** one shared world. Sign up with your name, email and password, and play
  alongside everyone else, with the same economy, the same elections and other players on
  the same streets.
- **Offline:** a world of your own, saved in your browser, which you can pause and speed up.

## Run it

```sh
npm install
npm run dev      # http://localhost:5174, with the online API; data goes to .data/ (no database needed)
npm test         # engine, business, multiplayer, server API, policy → outcome checks, and a 3-year soak
npm run build    # type-checks, builds dist/, and packs .vercel/output (site + API function) for Vercel
```

To use Postgres locally instead of `.data/`, or to make yourself an admin, put the settings in
`.env.local` (it is not committed), for example `ADMIN_EMAILS=you@example.com` and
`DATABASE_URL=postgres://user:pass@localhost:5432/naija_hustle`.
`node scripts/serve-vercel.mjs` runs the built Vercel bundle on port 5199, routed the way Vercel
routes it. `node scripts/api-smoke.mjs <url>` and `node scripts/online-walk.mjs <url> <dir>` check
the API and a two-player session against any running copy.

Dev-only console helpers: `__nh.skip(weeks)` plays forward on routine; `__nh.office('LA')`
makes you governor so you can try the budget session.

Screenshots with the dev server running (uses the installed Edge): `node scripts/walk3d.mjs <url> <dir> desktop|mobile <state> <LGA nick>`
plays the opening; `node scripts/stages.mjs <url> <dir> <LGA id>` fills every plot with a business at
a different stage.

## Online play

- **Accounts:** you sign up with a name, an email and a password. Your name is your
  character's name.
  - Passwords are hashed with scrypt.
  - Sessions are HttpOnly cookies, and the server stores only a hash of each one.
  - Ten wrong logins in ten minutes locks that email or address out for a while.
- **One world, one clock:** the server owns the world. Its clock runs in real time at
  `WORLD_RATE` game minutes per real minute: 12 by default, which makes a game hour five real
  minutes, a game day two hours and a game year about a month. Nobody can pause or speed it up.
- **Actions take real time:** a four-hour shift keeps your character busy for 20 real minutes.
  You can look around and use your phone meanwhile, and the screen counts down. Going to bed
  puts you to sleep until 6am world time.
- **When you are away:** your character goes on without you. It reads the paper, answers
  events with the first sensible choice, eats, goes to work or to its business, and sleeps.
  Last week's paper waits for you when you come back.
- **Other players:** they appear on the streets of the LGA they are in, labelled "Player". Their
  families keep to their own houses. You never receive anyone else's private details (money,
  inbox, needs).
  - Their businesses compete with yours, and you can be a customer at them.
  - Two players can run for the same office. If two players win the same party's primary, the
    one with more standing gets the ticket.
- **Staying in sync:** the screen asks for news every 4 seconds (every 20 when the tab is
  hidden). An unchanged world costs one tiny response.
- **Analytics:** every page load is counted as a visit, and every browser as a visitor (by a
  random id kept in that browser; no IP addresses are stored). Players count as online if
  they were active in the last 90 seconds; the game shows the count to everyone. Accounts
  listed in `ADMIN_EMAILS` get a "Players and visits" page at `/#stats` with:
  - who is online now;
  - accounts and characters;
  - visits and visitors per day for the last 14 days, with sign-ups.

## Deploying on Vercel

1. Import the GitHub repo in Vercel. Leave the build command as `npm run build`. It writes
   `.vercel/output` (Vercel's Build Output format), which Vercel deploys as is: the game as
   static files and `/api` as one Node function. The "Output Directory" setting is not used.
2. Add a database: **Storage → Create Database → Neon (Postgres)**, and connect it to the
   project. This sets `DATABASE_URL` for you. The tables (`nh_accounts`, `nh_sessions`,
   `nh_worlds`, `nh_visits`) are created on the first request.
3. Under **Settings → Environment Variables**, add `ADMIN_EMAILS` with your email (separate
   several with commas). Optionally, add `WORLD_RATE`.
4. Redeploy. Sign up on the live site with the admin email and open `/#stats`.

Without `DATABASE_URL` the server writes to `.data/`. That works locally but not on Vercel,
where function storage is temporary.

## Playing

- **Lagos is the real Lagos:** each of the seven Lagos LGAs is a district three to seven
  kilometres across, drawn from OpenStreetMap: its real streets, expressways, bridges, railway,
  lagoon and creeks, parks and industrial land, in their true places (shrunk about four to five
  times, so a walk across takes a minute or so). The places you use are the real ones where the
  map has them: Computer Village is Ikeja's market, the Ikeja Bus Terminal its motor park and
  Murtala Muhammed's domestic terminals its airport; Oshodi's motor park is the Transport
  Interchange; Lagos Island has Jankara Market, the Marina ferry terminal, Tafawa Balewa Square
  and Iga Idunganran; Yaba has Tejuosho, Yabatech and Herbert Macaulay Way; Ikorodu has Sabo
  Market, the bus terminal, the Oba's palace and the ferry terminal on the lagoon. Famous buildings
  (Tinubu Square, the National Museum, Freedom Park, Unilag, the Nigerian Law School, mosques
  and cathedrals) stand
  where they are, with their names. Ordinary buildings along the streets and the sea of rooftops
  behind them are generated. Street names show as you pass, and the bus stop is the real stop on
  the real road, with a footbridge over it.
- **Kano and Rivers** still use small invented towns: a main road with a median and lamp posts,
  side streets on a grid, open gutters, a bus stop, a footbridge, billboards and a filling
  station showing today's petrol price. Their real maps come next.
- **Walking:** places stand on plots along the roads, among houses, flats, churches, mosques,
  kiosks and abandoned buildings. Walk anywhere (on the pavement, crossing where people cross),
  or take a keke (an okada where it is not banned) for a small fare and no time. The minimap
  follows you through the streets; open it out to see the whole district and tap a place to go
  there. Buildings between you and the camera sink out of the way.
- **Getting around Lagos:** from the bus stop, danfos go to every other district along the real
  roads (Ikorodu to Lagos Island is 33 km via Ikorodu Road and Third Mainland Bridge), and rush
  hour makes them crawl. The BRT runs where its corridors do (Ikorodu–Yaba–Lagos Island,
  Oshodi–Ikeja) and skips most of the go-slow; the Red Line train links Ikeja, Oshodi and Yaba
  with no traffic at all. Ferries cross the lagoon between Ikorodu, the Marina, Apapa and Falomo.
  A ride-hailing car comes to wherever you are, door to door, at a price that surges with the
  traffic.
- **Getting to Kano and Port Harcourt:** long-distance buses leave the motor park in the morning
  (15 hours to Kano via Ibadan, Ilorin and Kaduna; 10 to Port Harcourt via Benin and Onitsha).
  Flights leave Murtala Muhammed in Ikeja for Mallam Aminu Kano and Port Harcourt International:
  dearer, and three hours door to door. The phone's Travel app shows Lagos and Nigeria on maps,
  every way there with its time and fare, and walks you to where it leaves from.
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
- **The phone** has the Travel app, bank alerts, your businesses' P&L, prices with charts,
  government, contacts, news and the map. While you travel, the route is drawn on the map.

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
  - `seats.ts`: a world holds many players; each player's private state is a seat, bound into
    the game while the engine works for them. `world.ts`: the shared world's real-time clock,
    nightly and weekly turnovers for everyone at once, and autopilot for players who are away.
  - `npc.ts`: everyone else's businesses and jobs. `culture.ts`: premieres, shows, matches and
    festivals. Both have their own random streams, so they do not change the dice for the rest of
    the world.
- `src/engine/map.ts`: the neighbourhood of each LGA as data: plots, which place or lot is on
  which plot, doors and walking routes. Lagos districts come from `src/data/city/lagos.json`;
  the rest from the grid generator. The rules use it to know which plots can be leased; the 3D
  world uses it to know where things stand. `streets.ts` is the walking network of a real
  district (pavements, crossings, A* routes); `travel.ts` is every way of travelling, with
  times and fares from the real road distances and the hour.
- The Lagos map is built ahead of time: `node scripts/fetch-city.mjs` downloads each district
  from OpenStreetMap's Overpass API into `data/osm/` (not committed), and
  `node scripts/build-city.mjs` turns it into `src/data/city/`: the rules' plots and places,
  one drawing file per district (loaded when you first go there) and the Lagos-wide travel map.
  `scripts/city-districts.mjs` says what area each district covers and which real places stand
  for which game places; `node scripts/draw-city.mjs OSH` draws a district to check it.
- `src/world/`: the 3D town, built with react-three-fiber. `City.tsx` draws a real district
  (merged road and water meshes, instanced buildings, rooftops, trees and lamps, landmarks,
  traffic and people on the real roads). `Town.tsx` has the grid towns' roads, lamps,
  filler buildings, vacant plots, bus stop, footbridge and billboards. `BizBuildings.tsx` has your
  businesses at each stage. There are also regional building styles, people with walk cycles,
  traffic on every road, a danfo that stops at the bus stop, day/night light, rain and
  NEPA-dependent lamps. There are no external 3D assets: everything is built in code.
- `server/`: the online API.
  - `api.ts`: routes.
  - `auth.ts`: accounts and sessions.
  - `game.ts`: loads the world, brings it up to now, applies actions under a lock, and sends
    each player their view.
  - `store.ts`: Postgres, or a JSON file for development.

  It runs inside Vite's dev server and as a Vercel function. `src/net/` is the browser's side.
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
- **Lagos districts are real places, not whole LGAs.** Each covers a few square kilometres around
  the LGA's best-known centre (Oshodi interchange, Ikeja and Alausa, Lagos Island, Yaba, Victoria
  Island and Ikoyi, Apapa, Ikorodu town), shrunk about four to five times. Roads, water, the railway and
  landmarks are where the map puts them; the buildings along the streets, the rooftops behind
  them and their heights are generated, and landmark buildings are generic models of their kind.
  Where the map has no real place for a game place (a skills centre, a party office), it goes on
  a street near the bus stop. Some districts reach past their LGA's edge (Oshodi's takes in
  Ladipo Market, which is in Mushin).
- **Kano and Rivers are still invented layouts:** the same kind of grid town, three blocks by
  three, dressed in each region's style, with real landmarks named rather than modelled.
- **Travel is simplified:** danfo, BRT, train and ferry fares and times come from the real road
  distances, a rush-hour curve and the game's fares, not from timetables. BRT buses and trains
  board at the bus stop. Interstate buses leave from any motor park and arrive at the state
  capital's park; flights are direct. Kano's airport is placed in Fagge, beside Sabon Gari (it
  sits just north of it), and Port Harcourt's in Obio/Akpor (it is in Omagwa, Ikwerre). The
  ride-hailing car is a generic service, not any real company.
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
- **Basic multiplayer:**
  - One shared world, with updates every few seconds rather than instantly.
  - No chat, and no trading or hiring between players. You cannot buy another player's
    business.
  - No password reset, and email addresses are not verified.
  - A world nobody visits for more than a game week skips ahead instead of replaying every day.
  - At most about three dozen named people live in each LGA, so in a busy LGA new players
    share the same faces.
- **Offline is still single-player:** your own world, with the same rules, saved in your browser.

## Credits

State boundaries: [geoBoundaries](https://www.geoboundaries.org/) gbOpen NGA ADM1 (source:
GRID3), CC BY 4.0.

Lagos map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available
under the [Open Database License](https://opendatacommons.org/licenses/odbl/) (ODbL). The district
files in `src/data/city/` are derived from it and are shared under the ODbL too; the game credits
OpenStreetMap on its maps.
