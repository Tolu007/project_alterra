// The Lagos districts built from real map data: the area each covers, how much it is shrunk to fit the game,
// and which real places stand in for the game's places. Shared by the fetch and build scripts.

/** Map metres per game unit, and the box (south, west, north, east) each district covers. */
export const DISTRICTS = {
  OSH: { name: 'Oshodi', m: 4, box: [6.5415, 3.3345, 6.5705, 3.3635] },
  IKJ: { name: 'Ikeja', m: 4.4, box: [6.5795, 3.327, 6.6215, 3.369] },
  LIS: { name: 'Lagos Island', m: 3.6, box: [6.4405, 3.3775, 6.4685, 3.4125] },
  LMA: { name: 'Yaba', m: 4, box: [6.4985, 3.3585, 6.5235, 3.3985] },
  ETI: { name: 'Lekki & VI', m: 5.5, box: [6.418, 3.41, 6.456, 3.47] },
  APP: { name: 'Apapa', m: 4.2, box: [6.43, 3.332, 6.458, 3.376] },
  IKD: { name: 'Ikorodu', m: 4.2, box: [6.598, 3.485, 6.633, 3.521] },
  // Kano: the old walled city, Sabon Gari, the GRA and Bompai, Dala, and the farm town of Kura.
  KMC: { name: 'Kano City', m: 4, box: [11.981, 8.502, 12.009, 8.532] },
  FAG: { name: 'Sabon Gari', m: 4, box: [11.998, 8.52, 12.028, 8.552] },
  NAS: { name: 'GRA & Bompai', m: 4.4, box: [11.975, 8.535, 12.005, 8.568] },
  DAL: { name: 'Dala', m: 4, box: [12.0, 8.485, 12.03, 8.517] },
  KUR: { name: 'Kura', m: 3.6, box: [11.76, 8.415, 11.787, 8.445] },
  // Rivers: Port Harcourt around Mile 1 and the GRA, Rumuokoro, Eleme, Bonny town and Okrika.
  PHC: { name: 'Mile 1 & GRA', m: 4.2, box: [4.772, 6.985, 4.802, 7.018] },
  OBI: { name: 'Rumuokoro', m: 4.2, box: [4.852, 6.98, 4.883, 7.013] },
  ELE: { name: 'Eleme', m: 4, box: [4.778, 7.105, 4.808, 7.138] },
  BON: { name: 'Bonny Island', m: 3.6, box: [4.42, 7.152, 4.448, 7.182] },
  OKR: { name: 'Okrika', m: 3.6, box: [4.726, 7.068, 4.754, 7.1] },
};

/** Lagos as a whole, for the travel map and the routes between districts. */
export const LAGOS_BOX = [6.395, 3.3, 6.66, 3.55];

/**
 * Real places for game places, by name (case-insensitive regex). The first pattern that matches a feature
 * in the district wins; a street name stands for a whole area (Broad Street for offices). `pattern=>Label`
 * renames a feature OSM leaves with a generic name. Places not listed go on a street near the bus stop.
 */
export const REAL_PLACES = {
  OSH: {
    park: ['Oshodi Transport Interchange - Terminal 1', 'Oshodi Transport Interchange'],
    market: ['^Market$=>Oshodi Market', 'Ladipo Market'],
    busstop: ['^Oshodi$', 'Anthony Bus Stop'],
    school: ['Oshodi Primary School'],
  },
  IKJ: {
    market: ['Computer Village'],
    park: ['Ikeja Bus Terminal'],
    airport: ['Murtala Muhammed Airport Terminal 2', 'MMA Domestic Terminal', 'Murtala Muhammed'],
    govhouse: ['^Lagos State Secretariat$', 'Alausa'],
    venue: ['New Afrika Shrine', 'Ikeja City Mall'],
    busstop: ['Ikeja Along', 'Allen', 'Ikeja City Mall'],
    clinic: ['Lagos State University Teaching Hospital'],
  },
  LIS: {
    market: ['Jankara Market', 'Balogun', 'Idumota Market', 'Ebute Ero Market'],
    park: ['Tafawa Balewa Square Bus Terminal', 'Obalende Motor Park'],
    busstop: ['^Idumota$', '^CMS', '^Marina$'],
    jetty: ['Marina/CMS Ferry Terminal', 'Marina/CMS'],
    venue: ['^Tafawa Balewa Square$'],
    palace: ['Iga Idunganran=>Iga Idunganran', 'Palace'],
    clinic: ['General Hospital Lagos', 'General Hospital'],
    school: ['CMS Grammar School', "King's College", "Saint Gregory's College"],
    office: ['^Broad Street', '^Marina$'],
  },
  LMA: {
    market: ['Tejuosho'],
    park: ['Yaba Bus Terminal'],
    busstop: ['^Ojuelegba', 'Alagomeji', 'Fadeyi'],
    school: ['Yaba College of Technology'],
    techhub: ['Herbert Macaulay'],
    clinic: ['Lagos University Teaching Hospital'],
  },
  ETI: {
    market: ['New Oniru Market'],
    park: ['Obalende Bus Terminus', 'Obalende Motor Park'],
    busstop: ['^Falomo$', 'Law School', 'Oniru'],
    jetty: ['Five Cowries Terminal', 'Five Cowries'],
    venue: ['^Eko Hotel'],
    office: ['Adeola Odeku', 'Ahmadu Bello Way', 'Akin Adesola'],
    clinic: ['^Reddington Hospital$', 'Gold Cross'],
    school: ['Government Junior College Victoria Island', "King's College"],
  },
  APP: {
    market: ['Apapa Market', 'Ajegunle Market', 'Market'],
    park: ['Apapa Bus', 'Mile 2', 'Motor Park', 'Bus Terminal'],
    jetty: ['Apapa Liverpool Jetty', 'Liverpool'],
    factory: ['Tin Can', 'Apapa Port', 'Wharf', 'Port'],
    venue: ['Apapa Amusement Park'],
    clinic: ['Hospital'],
  },
  IKD: {
    market: ['Sabo Market', 'Ita Elewa'],
    park: ['Ikorodu Bus Terminal', 'Ikorodu Garage'],
    jetty: ['Ikorodu Ferry Terminal', 'Ikorodu Terminal'],
    palace: ["Ikorodu Oba's Palace", 'Palace'],
    secretariat: ['Ikorodu local Govt', 'Ikorodu.*(Local|Govt|Council)'],
    school: ['Ikorodu High School', 'Ikorodu Senior Grammar'],
    busstop: ['Ikorodu Roundabout', 'Garage'],
  },
  KMC: {
    market: ['Kurmi', 'Kantin Kwari', 'Market'],
    palace: ['Emir.*Palace', 'Gidan Rumfa', 'Palace'],
    park: ['Motor Park', 'Park'],
    clinic: ['Murtala Muhammad Specialist Hospital', 'Hospital'],
    school: ['Rumfa College', 'School'],
  },
  FAG: {
    market: ['Sabon Gari Market', 'Singer', 'Market'],
    park: ['Motor Park', 'Park'],
    airport: ['Mallam Aminu Kano'],
    clinic: ['Hospital'],
  },
  NAS: {
    govhouse: ['Government House'],
    clinic: ['Aminu Kano Teaching Hospital', 'Hospital'],
    factory: ['Bompai'],
    market: ['Market'],
  },
  DAL: { market: ['Market'], clinic: ['Hospital'], school: ['School'] },
  KUR: { market: ['Market'], school: ['School'], clinic: ['Hospital'] },
  PHC: {
    market: ['Mile (1|One) Market', 'Mile (1|One)', 'Market'],
    park: ['Motor Park', 'Park'],
    govhouse: ['Government House'],
    clinic: ['Braithwaite', 'Hospital'],
    venue: ['Civic Centre', 'Stadium'],
  },
  OBI: { market: ['Rumuokoro Market', 'Market'], park: ['Motor Park', 'Park'], clinic: ['Hospital'], school: ['School'] },
  ELE: { factory: ['Refinery', 'Indorama', 'Petrochemical'], market: ['Market'], clinic: ['Hospital'] },
  BON: { jetty: ['Jetty', 'Terminal'], oilsite: ['NLNG', 'LNG'], market: ['Market'], clinic: ['Hospital'] },
  OKR: { jetty: ['Jetty'], oilsite: ['Refinery'], market: ['Market'], clinic: ['Hospital'] },
};

/** Real lines between the districts: the BRT corridors, the Red Line train, and the jetties ferries call at. */
export const BRT_LINES = [
  ['IKD', 'LMA', 'LIS'],
  ['OSH', 'IKJ'],
];
export const RAIL_LINES = [['IKJ', 'OSH', 'LMA']];
export const FERRY_JETTIES = ['LIS', 'IKD', 'APP', 'ETI'];

export function districtQuery([s, w, n, e]) {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:240];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${b});
  way["railway"~"^(rail|light_rail|subway)$"](${b});
  way["natural"~"^(water|coastline|wetland|beach|sand)$"](${b});
  relation["natural"="water"](${b});
  way["waterway"~"^(riverbank|canal|river)$"](${b});
  way["landuse"~"^(industrial|port|commercial|retail|cemetery|military|railway|basin|reservoir)$"](${b});
  way["leisure"~"^(park|stadium|golf_course)$"](${b});
  way["aeroway"~"^(runway|apron)$"](${b});
  nwr["amenity"~"^(marketplace|bus_station|ferry_terminal|university|college|school|hospital|townhall|place_of_worship|courthouse|cinema|theatre)$"]["name"](${b});
  nwr["shop"="mall"]["name"](${b});
  nwr["tourism"~"^(attraction|museum)$"]["name"](${b});
  nwr["public_transport"="station"]["name"](${b});
  nwr["highway"="bus_stop"]["name"](${b});
  nwr["office"="government"]["name"](${b});
  nwr["building"="government"]["name"](${b});
  nwr["historic"]["name"](${b});
  nwr["landuse"~"^(retail|commercial|industrial|port)$"]["name"](${b});
  nwr["aeroway"~"^(aerodrome|terminal)$"](${b});
  nwr["building"]["name"~"Palace|Secretariat|Terminal|Market|Mall|Mosque|Cathedral",i](${b});
);
out geom;`;
}
