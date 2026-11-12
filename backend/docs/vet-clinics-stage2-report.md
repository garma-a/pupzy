# Stage 2 dataset review report

414 active / 22 inactive nationally in this staged release.

| Governorate | Active | Inactive | Exact / street / area | 24-hour |
| ----------- | -----: | -------: | --------------------- | ------: |
| Alexandria  |    110 |        1 | 1 / 5 / 105           |       7 |
| Port Said   |      9 |        3 | 0 / 0 / 12            |       1 |
| Cairo       |    181 |       14 | 3 / 24 / 168          |      20 |
| Giza        |    112 |        4 | 1 / 6 / 109           |      16 |

Parts A/B: 0067 contains the escaped phone constraint and location_precision; 0068 is the regenerated release. Both snapshots and the journal agree. Shared admin/backend phone fixtures, translated generic name descriptors, source aliases, checklist normalization, reviewed shared-phone ownership, GraphQL hours/Facebook documentation and approximate-location Maps handoff are implemented. Main files: vet-clinics.schema.ts, vet-clinics/{catalog,geocoding,pipeline,migration,vet-clinics.service,vet-clinics.repository}.ts, vet-clinics.graphql and admin-service clinic resources/mutations.

Generated from the checked-in reviewed inputs. Consultation/block/exclusion details are in vet-clinics-research.md and vet-clinics-research-extra.md. Random samples use SHA-256 ordering with seed 20261112, without replacement.

## Alexandria

**110 active / 1 inactive; 7 explicit 24-hour clinics.**

Cross-source duplicate records merged: 1.

Clinic sources from multiple domains: 42/111; single-domain: 69; dated operating/listing evidence: 38/111. Geocoder responses do not count as clinic corroboration. Mirrors may reproduce clinic posts and are not independent witnesses of operation.

Precision (all retained): exact: 1; street: 5; area: 105.

Inactive reasons: {"no-phone":1}

Distinct retained source pages by site: www.openstreetmap.org: 1; www.dalilimedical.com: 46; welpstar.com: 52; www.voofla.com: 23; www.bizmideast.com: 2; dalil140.com: 7; animalplanet.clinic: 1; sites.google.com: 1; www.petshops1.com: 9; www.wslny.com: 2; www.findglocal.com: 3; www.evcindex.com: 1; www.findinegypt.com: 1; superpetegy.com: 1.

Cached consultations by site (distinct readable pages, including discovery and held leads): www.voofla.com: 20; www.petshops1.com: 9; www.wslny.com: 2; www.evcindex.com: 1; welpstar.com: 13; www.findglocal.com: 1; www.dalilimedical.com: 9; localegypt.net: 2.

Blocked/error response pages by site: www.dalilimedical.com: 39; welpstar.com: 35; www.bizmideast.com: 2; dalil140.com: 1. Individually rendered web facts are separately labeled in snapshots when direct fetching was blocked.

Import accounting (web candidates before cross-source/OSM merging):

```json
{
  "candidates": 113,
  "imported": 111,
  "excluded": [
    {
      "key": "sabry-abdel-gawad-wingat",
      "reason": "no-catalog-area",
      "area": "Winget"
    },
    {
      "key": "salwa-refaey-shalalat",
      "reason": "no-catalog-area",
      "area": "Shalalat"
    }
  ]
}
```

Discovery group exclusions (groups can contain multiple businesses): government-or-livestock: 3; pharmacy-trade-only: 1; evidence-of-relocation-or-closure: 1. Earlier discovery holds: conflicting-address: 3; unresolved-specific-area: 1; conflicting-identity: 2; unresolved-pet-clinic: 3; missing-contact-address: 1; unconfirmed-branch: 1; unresolved-address: 1; blocked-individual-evidence: 1. Additional final review holds: conflicting-brand-at-same-address-phone: 1; current-source-shop-medical-on-call-only: 2; no-independent-pet-clinic-evidence: 2; duplicate-discovery-source-without-independent-evidence: 1. These historical discovery groups overlap; final import/release counts above govern.

Discovery exclusions, historical identity merges and unresolved holds: see [Alexandria research](vet-clinics-research.md) and the corresponding research-alexandria-ledger.json. Discovery categories and ledger groups can overlap and are not added to the authored candidate denominator above.

| Random active clinic                                                           | Phone         | Precision | Sources                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dr. Nour Veterinary Center / مركز دكتور نور البيطري                            | +201280677776 | area      | [1](https://www.dalilimedical.com/en/doctor-18774/Dr-Nour-Veterinary-Center)                                                                                                                                                                                                         |
| Dr. Abdel Rahman Awad Veterinary Clinic / عيادة دكتور عبد الرحمن عوض البيطرية  | +201022525576 | area      | [1](https://www.dalilimedical.com/doctor-8366/%D8%AF%D9%83%D8%AA%D9%88%D8%B1-%D8%B9%D8%A8%D8%AF-%D8%A7%D9%84%D8%B1%D8%AD%D9%85%D9%86-%D9%85%D8%AD%D9%85%D8%AF-%D8%B9%D9%88%D8%B6-%D8%B7%D8%A8%D9%8A%D8%A8-%D8%A8%D9%8A%D8%B7%D8%B1%D9%89)                                            |
| Facedog Veterinary Clinic / عيادة فيس دوج البيطرية                             | +201096677558 | area      | [1](https://welpstar.com/en/biz/facedog-vet-clinic), [2](https://www.petshops1.com/EG/Alexandria/102883401313978/FaceDog-Vet-Clinic)                                                                                                                                                 |
| Canadian Veterinary Hospital / المستشفى البيطري الكندي                         | +201507553909 | area      | [1](https://www.dalilimedical.com/doctor-17965/%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%B4%D9%81%D9%89-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%89-%D8%A7%D9%84%D9%83%D9%86%D8%AF%D9%89)                                                                                                     |
| Veterinary Clinic (Soyouf Qebli) / العيادة البيطرية (السيوف قبلي)              | +201221545446 | area      | [1](https://welpstar.com/en/biz/%D8%A7%D9%84%D8%B9%D9%8A%D8%A7%D8%AF%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%8A%D8%A9)                                                                                                                                                         |
| Dr. Sabry Abdel Gawad Veterinary Clinic / عيادة دكتور صبري عبد الجواد البيطرية | +201207529990 | area      | [1](https://www.dalilimedical.com/en/doctor-20626/Dr-Sabry-Abdel-Gawad-veterinarian)                                                                                                                                                                                                 |
| Dr. Monem Pet Hospital / مستشفى دكتور منعم البيطري                             | +201274468889 | area      | [1](https://welpstar.com/en/biz/dr-men3am-pet-hospital-%D9%85%D8%B3%D8%AA%D8%B4%D9%81%D9%8A-%D9%88%D8%B9%D9%8A%D8%A7%D8%AF%D9%87-%D8%B7%D9%88%D8%A7%D8%B1%D9%89%D8%A1-%D8%A8%D9%8A%D8%B7%D8%B1%D9%8A%D8%A9)                                                                          |
| Dr. Reda Hajjaj Veterinary Clinic / عيادة دكتور رضا حجاج البيطرية              | +201206267660 | area      | [1](https://www.evcindex.com/item/%D8%B9%D9%8A%D8%A7%D8%AF%D9%87-%D8%AF%D9%83%D8%AA%D9%88%D8%B1-%D8%B1%D8%B6%D8%A7-%D8%AD%D8%AC%D8%A7%D8%AC-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%8A%D9%87/), [2](https://www.wslny.com/index.php/company/Dr.-Reda-Hajjaj-veterinary-clinic/33650) |
| Healthy Pets Veterinary Clinic / عيادة هيلثي بيتس البيطرية                     | +201111222696 | area      | [1](https://welpstar.com/en/biz/healthy-pets-clinic)                                                                                                                                                                                                                                 |
| Fluffy Pets Veterinary Center / مركز فلافي بيتس البيطري                        | +2035455247   | area      | [1](https://welpstar.com/en/biz/fluffy-pets-center-%D9%85%D8%B1%D9%83%D8%B2-%D9%81%D9%84%D8%A7%D9%81%D9%89-%D8%A8%D9%8A%D8%AA%D8%B3-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%89)                                                                                                      |

## Port Said

**9 active / 3 inactive; 1 explicit 24-hour clinics.**

Cross-source duplicate records merged: 0.

Clinic sources from multiple domains: 8/12; single-domain: 4; dated operating/listing evidence: 10/12. Geocoder responses do not count as clinic corroboration. Mirrors may reproduce clinic posts and are not independent witnesses of operation.

Precision (all retained): exact: 0; street: 0; area: 12.

Inactive reasons: {"no-phone":3}

Distinct retained source pages by site: www.voofla.com: 10; www.bizmideast.com: 2; www.jobs-arab.com: 1; www.fisharapets.com: 1; besbes.app: 4; www.petshops1.com: 1; egypt.worldplaces.me: 1; www.evcindex.com: 1; dalil140.com: 1.

Cached consultations by site (distinct readable pages, including discovery and held leads): www.voofla.com: 13; www.facebook.com: 13; www.findinegypt.com: 1; www.fisharapets.com: 2; www.evcindex.com: 2; www.petshops1.com: 1; www.jobs-arab.com: 1; besbes.app: 4; dalil140.com: 1.

Blocked/error response pages by site: dalil140.com: 1; egypt.worldplaces.me: 1; www.megabizdir.com: 1; eg.locale.online: 1; www.bizmideast.com: 4; www.govserv.org: 1. Individually rendered web facts are separately labeled in snapshots when direct fetching was blocked.

Import accounting (web candidates before cross-source/OSM merging):

```json
{
  "candidates": 12,
  "imported": 12,
  "excluded": []
}
```

20 discovery candidates: excluded closure-evidence: 1; government-unit: 2; manufacturer-not-clinic: 1; held unresolved-current-pet-treatment: 1; unresolved-pet-treatment: 1; 2 historical/page identities consolidated; 12 retained.

Discovery exclusions, historical identity merges and unresolved holds: see [Port Said research](vet-clinics-research-port-said.md) and the corresponding research-port-said-ledger.json. Discovery categories and ledger groups can overlap and are not added to the authored candidate denominator above.

| Random active clinic                                                    | Phone         | Precision | Sources                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All 9 available active clinics are sampled below.                       |               |           |                                                                                                                                                                                                                                                                                                                                                                                                              |
| Fishara Pets Clinic / عيادة فشارة للحيوانات الأليفة                     | +201003987987 | area      | [1](https://www.voofla.com/EG/Port-Said/123219601067327/Fishara-Pets-Clinic), [2](https://www.fisharapets.com/), [3](https://besbes.app/business/32c346ea-db82-4c7f-84a2-879d9584f576)                                                                                                                                                                                                                       |
| Golden Elite Veterinary Center / مركز جولدن إيليت البيطري               | +201022208884 | area      | [1](https://www.voofla.com/EG/Port-Said/172871795909369/Elite-Veterinary-Center), [2](https://www.jobs-arab.com/eg/jobs/714282/)                                                                                                                                                                                                                                                                             |
| Vet Care Point / مركز الرعاية البيطرية                                  | +201276763276 | area      | [1](https://www.bizmideast.com/EG/%D9%85%D8%B1%D9%83%D8%B2-%D8%A7%D9%84%D8%B1%D8%B9%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%8A%D8%A9-vet-care-point-%D8%AF-012-76763276), [2](https://besbes.app/business/a285bb21-1245-402a-93c1-9f62e425fb0c)                                                                                                                                            |
| Dr. Youssef Eldesoky Vet Clinic / عيادة دكتور يوسف الدسوقي البيطرية     | +201221888065 | area      | [1](https://www.voofla.com/EG/Port-Said/108735338246667/Dr-Youssef-ELDesoky-vet-clinic-%D8%B9%D9%8A%D8%A7%D8%AF%D9%87-%D8%AF%D9%83%D8%AA%D9%88%D8%B1-%D9%8A%D9%88%D8%B3%D9%81-%D8%A7%D9%84%D8%AF%D8%B3%D9%88%D9%82%D9%8A-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%8A%D9%87), [2](https://besbes.app/business/6f0855b1-f2ad-4ed0-91c3-f8a365666b20)                                                            |
| Best Friend Pet's Clinic & Store / عيادة بيست فريند البيطرية            | +201018895078 | area      | [1](https://www.voofla.com/EG/Port-Said/1358887300631128/Best-Friend--%D8%A7%D9%84%D8%B9%D9%8A%D8%A7%D8%AF%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%8A%D8%A9), [2](https://www.voofla.com/EG/Port-Said/140843306525673/Best-Friend-%D8%A7%D9%84%D8%B9%D9%8A%D8%A7%D8%AF%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%8A%D8%A9), [3](https://www.bizmideast.com/EG/best-friend-vet-clinic-011-15757536) |
| Port Said Pet Center / مركز بورسعيد البيطري                             | +201222476476 | area      | [1](https://www.evcindex.com/item/%D9%85%D8%B1%D9%83%D8%B2-%D8%A8%D9%88%D8%B1%D8%B3%D8%B9%D9%8A%D8%AF-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%89/), [2](https://dalil140.com/company/ar/420832-port-said-pet-center)                                                                                                                                                                                         |
| Modern Pet Center (Port Fouad) / مركز مودرن للحيوانات الأليفة (بورفؤاد) | +201228106335 | area      | [1](https://www.petshops1.com/EG/Port-Said/2816127161751869/Modern-Pet-Center), [2](https://besbes.app/business/84afaf56-ad55-4d97-97dc-7eba664533ff), [3](https://egypt.worldplaces.me/medical-and-health-in-port-said/59334874-pet-life-clinics-egypt.html)                                                                                                                                                |
| My Pets Vet Center / مركز ماي بيتس البيطري                              | +201019590144 | area      | [1](https://www.voofla.com/EG/Port-Said/103037605942285/my-pets-vet-center)                                                                                                                                                                                                                                                                                                                                  |
| Modern Pet Center (Port Said) / مركز مودرن للحيوانات الأليفة (بورسعيد)  | +201030152250 | area      | [1](https://www.petshops1.com/EG/Port-Said/2816127161751869/Modern-Pet-Center), [2](https://www.voofla.com/EG/Port-Said/2816127161751869/Modern-Pet-Center)                                                                                                                                                                                                                                                  |

## Cairo

**181 active / 14 inactive; 20 explicit 24-hour clinics.**

Cross-source duplicate records merged: 0.

Clinic sources from multiple domains: 26/195; single-domain: 169; dated operating/listing evidence: 24/195. Geocoder responses do not count as clinic corroboration. Mirrors may reproduce clinic posts and are not independent witnesses of operation.

Precision (all retained): exact: 3; street: 24; area: 168.

Inactive reasons: {"no-phone":5,"stale-evidence":9}

Distinct retained source pages by site: www.openstreetmap.org: 3; www.evcindex.com: 188; www.americanvetcenter.com: 6; www.britishanimalhospital.com: 8; www.findglocal.com: 1; vet-trust.com: 1; www.to-all.com: 2; drpaws.com.eg: 2; infinity-petcare.com: 1; usepetbook.com: 1; www.lafamiliaeg.com: 1; www.mojovetcare.com: 1; moonpetsclinic.com: 2; www.findhealthclinics.org: 1; healtheg.com: 1; www.nyvetclinic.com: 1; www.voofla.com: 2; www.wslny.com: 2; petcureclinics.com: 2; petshineclinic.com: 1; www.petshops1.com: 1; rafikivet.com: 1.

Cached consultations by site (distinct readable pages, including discovery and held leads): www.evcindex.com: 230; www.wslny.com: 2; usepetbook.com: 1; moonpetsclinic.com: 2; www.britishanimalhospital.com: 6; www.findhealthclinics.org: 1; dalil140.com: 8; www.petshops1.com: 1; www.voofla.com: 2; petshineclinic.com: 1; www.americanvetcenter.com: 6; vet-trust.com: 1; rafikivet.com: 1; healtheg.com: 1; circle.vet: 1; petcureclinics.com: 1; medicareeg.com: 1; www.nyvetclinic.com: 1; www.mojovetcare.com: 1; www.to-all.com: 2; www.lafamiliaeg.com: 1; infinity-petcare.com: 1.

Blocked/error response pages by site: www.evcindex.com: 99; www.britishanimalhospital.com: 4; www.americanvetcenter.com: 1; www.bizmideast.com: 1. Individually rendered web facts are separately labeled in snapshots when direct fetching was blocked.

Import accounting (web candidates before cross-source/OSM merging):

```json
{
  "candidates": 193,
  "imported": 192,
  "excluded": [
    {
      "key": "flamingo-malek-saleh",
      "reason": "no-catalog-area",
      "area": "الملك الصالح"
    }
  ]
}
```

Additional-entry holds/exclusions: home-visit-only: 2; governorate-unresolved: 1; boarding-only: 1; unresolved-physical-clinic: 1; shop-without-clinical-evidence: 1; unresolved-pet-treatment: 2; veterinary-supplier-pharmacy: 1; pharmacy-only: 2; unresolved-ownership: 1; government-military: 1; alternate-premises-held: 1; outside-target-governorates: 2; unresolved-shared-phone: 1; unresolved-relocation-or-branch: 1; veterinary-equipment-supplier: 1. Attached to existing identities: 14.

Discovery exclusions, historical identity merges and unresolved holds: see [Cairo research](vet-clinics-research-cairo.md) and the corresponding research-cairo-ledger.json. Discovery categories and ledger groups can overlap and are not added to the authored candidate denominator above.

| Random active clinic                                                                   | Phone         | Precision | Sources                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dr. Youssef Kamal Veterinary Clinic / عيادة د. يوسف كمال البيطرية                      | +201001749380 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%af-%d9%8a%d9%88%d8%b3%d9%81-%d9%83%d9%85%d8%a7%d9%84-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9/)                                                              |
| Pets Home Clinic (Nozha) / عيادة بيتس هوم البيطرية (النزهة)                            | +201019612354 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a8%d9%8a%d8%aa%d8%b3-%d9%87%d9%88%d9%85-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9/)                                                                           |
| Dr. Sayed El Zomor Veterinary Clinic / عيادة دكتور سيد الزمر البيطرية                  | +20225198939  | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%af%d9%83%d8%aa%d9%88%d8%b1-%d8%b3%d9%8a%d8%af-%d8%a7%d9%84%d8%b2%d9%85%d8%b1-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9/)                                      |
| Oasis Veterinary Clinic / عيادة أويسز البيطرية                                         | +201061000992 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a7%d9%88%d9%8a%d8%b3%d8%b2-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9/)                                                                                        |
| Zamalek Veterinary Clinic / عيادة الزمالك البيطرية                                     | +20227353294  | area      | [1](https://www.evcindex.com/item/%D8%B9%D9%8A%D8%A7%D8%AF%D8%A9-%D8%A7%D9%84%D8%B2%D9%85%D8%A7%D9%84%D9%83-%D8%A7%D9%84%D8%A8%D9%8A%D8%B7%D8%B1%D9%8A%D8%A9/)                                                                            |
| Pet Point Vet Clinic / عيادة بيت بوينت البيطرية                                        | +201016229132 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a8%d9%8a%d8%aa-%d8%a8%d9%88%d9%8a%d9%86%d8%aa-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9/)                                                                     |
| Yoo Pets Clinic / عيادة يوو للحيوانات الأليفة                                          | +201099524277 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d9%8a%d9%88%d9%88-%d9%84%d9%84%d8%ad%d9%8a%d9%88%d8%a7%d9%86%d8%a7%d8%aa-%d8%a7%d9%84%d8%a3%d9%84%d9%8a%d9%81%d8%a9%d8%8c-%d8%af%d9%83%d8%aa%d9%88%d8%b1%d8%a9-%d8%a2/) |
| Zoofix Veterinary Center / عيادة زوو فيكس البيطرية                                     | +201012937293 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%b2%d9%88%d9%88-%d9%81%d9%8a%d9%83%d8%b3-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9-zoofix-veterinary-center/)                                                  |
| Dalmatian Veterinary Clinic / عيادة دالميشن البيطرية                                   | +20226389236  | area      | [1](https://www.evcindex.com/item/%d8%af%d8%a7%d9%84%d9%85%d9%8a%d8%b4%d9%86-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9-%d9%84%d8%b9%d9%84%d8%a7%d8%ac-%d8%a7%d9%84%d8%ad%d9%8a%d9%88%d8%a7%d9%86%d8%a7%d8%aa-%d8%a7%d9%84%d8%a3/)  |
| Pet Zone Veterinary Clinic (Fifth Settlement) / عيادة بيت زون البيطرية (التجمع الخامس) | +20225606590  | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a8%d9%8a%d8%aa-%d8%b2%d9%88%d9%86-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9-%d8%a7%d9%84%d8%aa%d8%ac%d9%85%d8%b9-%d8%a7%d9%84%d8%ae%d8%a7%d9%85%d8%b3/)       |

## Giza

**112 active / 4 inactive; 16 explicit 24-hour clinics.**

Cross-source duplicate records merged: 0.

Clinic sources from multiple domains: 18/116; single-domain: 98; dated operating/listing evidence: 18/116. Geocoder responses do not count as clinic corroboration. Mirrors may reproduce clinic posts and are not independent witnesses of operation.

Precision (all retained): exact: 1; street: 6; area: 109.

Inactive reasons: {"no-phone":4}

Distinct retained source pages by site: www.openstreetmap.org: 1; www.evcindex.com: 99; www.americanvetcenter.com: 1; www.britishanimalhospital.com: 6; www.al-makan.com: 6; www.findglocal.com: 7; www.catdoghospital6oct.com: 1; columbiaanimalhosp.wixsite.com: 1; www.voofla.com: 2; www.findinegypt.com: 1; drpaws.com.eg: 3; www.elitevetcenter.com: 1; familyvetcenter.com: 1; linktr.ee: 1; worldcarepet.com: 1; www.nyvetclinic.com: 1; www.findhealthclinics.org: 1; pawiaegy.durable.site: 1; petzoneclinics.com: 1; pets-mall.net: 1; www.vethelpclinic.com: 1.

Cached consultations by site (distinct readable pages, including discovery and held leads): www.evcindex.com: 151; www.americanvetcenter.com: 2; www.nyvetclinic.com: 1; www.findglocal.com: 12; familyvetcenter.com: 1; www.vethelpclinic.com: 1; www.britishanimalhospital.com: 6; www.voofla.com: 2; www.al-makan.com: 7; drpawss.com: 1; www.findhealthclinics.org: 1; columbiaanimalhosp.wixsite.com: 1; drpaws.com.eg: 4; www.dalilimedical.com: 1; pets-mall.net: 1; linktr.ee: 1; petzoneclinics.com: 1; pawiaegy.durable.site: 1; kmtvets.com: 1; worldcarepet.com: 1; www.catdoghospital6oct.com: 1; www.elitevetcenter.com: 1; www.findinegypt.com: 1.

Blocked/error response pages by site: www.americanvetcenter.com: 1; www.bizmideast.com: 1; www.findglocal.com: 5; www.al-makan.com: 1. Individually rendered web facts are separately labeled in snapshots when direct fetching was blocked.

Import accounting (web candidates before cross-source/OSM merging):

```json
{
  "candidates": 115,
  "imported": 115,
  "excluded": []
}
```

excluded: boarding-only: 1; home-visit-only: 5; livestock-only: 2; outside-target-governorates: 10; government-unit: 5; pharmacy-products-only: 3. merged: existing-identity: 8. held: unresolved-specific-area: 2; unresolved-pet-treatment: 4; unresolved-identity-or-ownership: 5; blocked-rate-limit: 5

Discovery exclusions, historical identity merges and unresolved holds: see [Giza research](vet-clinics-research-giza.md) and the corresponding research-giza-ledger.json. Discovery categories and ledger groups can overlap and are not added to the authored candidate denominator above.

| Random active clinic                                                       | Phone         | Precision | Sources                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CatDog Hospital / مستشفى كات دوج                                           | +201032288638 | area      | [1](https://www.catdoghospital6oct.com/), [2](https://www.evcindex.com/item/%d9%85%d8%b3%d8%aa%d8%b4%d9%81%d9%89-%d9%83%d8%a7%d8%aa-%d8%af%d9%88%d8%ac-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9-6-%d8%a3%d9%83%d8%aa%d9%88%d8%a8%d8%b1-%d8%b7%d9%88%d8%a7%d8%b1%d8%a6/)                                                                                 |
| Elite Veterinary Center / مركز إيليت البيطري                               | +201099010555 | area      | [1](https://www.elitevetcenter.com/)                                                                                                                                                                                                                                                                                                                            |
| Just Pets Vet Clinic / عيادة جاست بيتس البيطرية                            | +201016165165 | area      | [1](https://www.evcindex.com/item/%d8%ac%d8%a7%d8%b3%d8%aa-%d8%a8%d9%8a%d8%aa%d8%b3-%d8%af-%d8%a3%d8%ad%d9%85%d8%af-%d8%b9%d9%84%d9%8a-%d8%a7%d9%85%d9%8a%d9%86/)                                                                                                                                                                                               |
| Vet Help Clinic / عيادة فيت هيلب                                           | +201126291657 | area      | [1](https://www.vethelpclinic.com/en)                                                                                                                                                                                                                                                                                                                           |
| Pets Island Vet (Beverly Hills) / عيادة بيتس آيلاند البيطرية (بيفرلي هيلز) | +201063600999 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9-pets-island-vet/)                                                                                                                                                                                                                                         |
| Go Vet Veterinary Clinic / عيادة جو فيت البيطرية                           | +201033670022 | area      | [1](https://www.evcindex.com/item/%d8%a7%d9%84%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9-go-vet-%d9%81%d9%8a%d8%b5%d9%84-%d8%b3%d9%87%d9%84-%d8%ad%d9%85%d8%b2%d8%a9/), [2](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a7%d9%84%d9%87%d8%b1%d9%85-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9/) |
| Nour Vet Veterinary Clinic / عيادة نور فيت البيطرية                        | +201110203159 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d9%86%d9%88%d8%b1-%d9%81%d9%8a%d8%aa-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9%d8%8c-%d8%b4%d8%a7%d8%b1%d8%b9-%d9%81%d9%8a%d8%b5%d9%84%d8%8c-%d8%a7%d9%84%d8%ac/)                                                                                                                      |
| Pets World Vet Center / مركز بيتس وورلد البيطري                            | +201001933619 | area      | [1](https://www.evcindex.com/item/%d9%85%d8%b1%d9%83%d8%b2-%d8%a8%d9%8a%d8%aa%d8%b3-%d9%88%d9%88%d8%b1%d9%84%d8%af-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a-%d8%ad%d8%af%d8%a7%d8%a6%d9%82-%d8%a7%d9%84%d8%a3%d9%87%d8%b1%d8%a7%d9%85/)                                                                                                                       |
| Vet and Pet Clinic / عيادة فيت أند بيت البيطرية                            | +201282009288 | area      | [1](https://www.evcindex.com/item/%d8%a7%d9%84%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9-%d9%81%d9%8a%d8%aa-%d8%a3%d9%86%d8%af-%d8%a8%d9%8a%d8%aa/)                                                                                                                                                                        |
| Dr. Khaled Ali Veterinary Clinic / عيادة الدكتور خالد علي البيطرية         | +201008233425 | area      | [1](https://www.evcindex.com/item/%d8%b9%d9%8a%d8%a7%d8%af%d8%a9-%d8%a7%d9%84%d8%af%d9%83%d8%aa%d9%88%d8%b1-%d8%ae%d8%a7%d9%84%d8%af-%d8%b9%d9%84%d9%8a-%d8%a7%d9%84%d8%a8%d9%8a%d8%b7%d8%b1%d9%8a%d8%a9/)                                                                                                                                                      |

## Validation and handoff — 2026-11-12

All four serial governorate checkpoints are complete. Final totals: **414 active / 22 inactive nationally**, including **412 active / 22 inactive in the four researched governorates**. No agents, dependency installs, frontend changes, production actions, commits or pushes were used in this continuation.

| Check                                                                                                                                  | Result                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                                                                                         | Pass; the final report-script formatting is also linted separately                                                    |
| `npm run build`                                                                                                                        | Pass                                                                                                                  |
| `npm run test:unit -- --runInBand`                                                                                                     | 105 suites, 1,337 tests pass; one lead-checklist skip                                                                 |
| `cd admin-service && npm test`                                                                                                         | 449 tests pass                                                                                                        |
| Vet-clinics non-integration suite                                                                                                      | 7 suites, 91 tests pass; one checklist skip                                                                           |
| Record schemas, phone ownership before deduplication, names/aliases/branches, sourced coordinates and district/governorate containment | Pass                                                                                                                  |
| Cached Arabic/English street attempts and offline dataset/report/0068 regeneration                                                     | Pass                                                                                                                  |
| `drizzle-kit generate`                                                                                                                 | No schema changes; no probe migration created; journal ends at 68                                                     |
| `tsc --noEmit --pretty false`                                                                                                          | 157 existing diagnostics; clean committed 36543a1 archive also has 157, with identical file/error-code multiplicities |
| Changed-file formatting and `git diff --check`                                                                                         | Pass                                                                                                                  |
| Independent clinic checklist                                                                                                           | Lead-owned file absent; skipped as instructed                                                                         |
| Integration suites                                                                                                                     | Not run here: Docker unavailable                                                                                      |

The lead should run `src/vet-clinics/release.integration.spec.ts` and `src/vet-clinics/vet-clinics.integration.spec.ts`, plus the existing `src/database/migrate.integration.spec.ts` and `src/cities/neighbourhoods.integration.spec.ts` migration regressions. The lead's earlier stage-1 integration run does not substitute for checking the updated precision/area release behavior.

## Decisions, weaknesses and stage 3

- [Shared-contact review](../src/vet-clinics/data/research-shared-phone-holds.json): five conflicts, disputed numbers withheld from nine records. Cairo's final active count is 181, superseding its pre-Giza checkpoint. Pawia's own current contact page takes priority over the conflicting Prime directory entry. Pets Choice retains separate published numbers pending explicit branch evidence.
- Happy Pets' two doctor-named entries with identical reception contacts/Facebook identity and distinct Nasr City/Mohandessin addresses are preserved as documented branches. New York's own contact page explicitly lists Maadi and October. No cross-governorate branch was collapsed in the final release; its only release merge is the Alexandria Kashif/Kashef identity.
- Alexandria's Winget/Shalalat and Cairo's Flamingo/El Malek El Saleh remain outside the imported release because no unique catalog area was established. No point was invented or shifted. Most retained locations are still area centers; street results are accepted only with exact street-name and original district containment checks.
- Port Said yields nine active clinics, so its sample contains all nine. Its [research note](vet-clinics-research-port-said.md) accounts for 20 named candidates, closure evidence, government units, historical identities and treatment-scope holds. There is no claim of market completeness.
- Multiple source domains do not necessarily mean independent operational evidence: mirrored clinic feeds and directories can share content. Dated counts exclude access dates. Phone reachability was not tested. Blocked sources were recorded, not bypassed; none of the source/map points came from Google Maps.
- Stage 3 must research the other 23 governorates using the same serial cache/import/build/quality checkpoints, resolve held identities/contacts cheaply where possible, improve dated/corroborating evidence, and obtain the independent lead checklist. National active coverage is **6/27**, so the final all-governorate gate (`VET_CLINICS_FINAL=1`) remains deferred to stage 3.
