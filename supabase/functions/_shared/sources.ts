// Display names for Mogul source targets. Shared by the backend and the web app.
export const SOURCE_NAMES: Record<string, string> = {
  DISTROKID: "DistroKid", TUNECORE: "TuneCore", CD_BABY: "CD Baby", TOO_LOST: "Too Lost", TOOLOST: "Too Lost",
  UNITED_MASTERS: "UnitedMasters", UNITEDMASTERS: "UnitedMasters", THE_ORCHARD: "The Orchard", EMPIRE: "EMPIRE",
  SYMPHONIC: "Symphonic", DITTO: "Ditto", ROUTE_NOTE: "RouteNote", CMDSHFT: "CMDSHFT", DASHGO: "Dashgo",
  JTV_DIGITAL: "JTV Digital", MONSTERCAT: "Monstercat", EDDY: "Eddy", VYDIA: "Vydia", FOUNDATION_MEDIA: "Foundation Media",
  ZOJACK: "Zojack", INGROOVES: "INgrooves", ARMADA_MUSIC: "Armada Music", INTEGRITY_MUSIC: "Integrity Music",
  NEW_WEST_RECORDS: "New West Records", PLATOON: "Platoon", CURVE: "Curve", SPARTA: "Sparta", MATADOR_RECORDS: "Matador Records",
  NINJA_TUNE: "Ninja Tune", DISTRO_NATION: "Distro Nation", SONY_RECORDS: "Sony Music", WARNER_MUSIC_GROUP: "Warner Music Group",
  UNIVERSAL_MUSIC_GLOBAL: "Universal Music", UNIVERSAL_MUSIC_NORTH_AMERICA: "Universal Music", BMG: "BMG", OWSLA: "OWSLA",
  POSITION_MUSIC: "Position Music", SECRETLY_DISTRIBUTION: "Secretly Distribution", CURB: "Curb", ROYALTY_SHARE: "Royalty Share",
  DINE_ALONE_RECORDS: "Dine Alone Records", KOLLECTIVE: "Kollective", ZYNC: "Zync", REDEYE_WORLDWIDE: "Redeye Worldwide",
  BANDCAMP: "Bandcamp", AWAL: "AWAL", AMUSE: "Amuse", BELIEVE: "Believe", EGO: "Ego",
};

export const sourceDisplayName = (t?: string | null, fallback = "your distributor") =>
  t ? SOURCE_NAMES[t] ?? t.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : fallback;
