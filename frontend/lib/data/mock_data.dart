import '../models/pet.dart';

class MockData {
  MockData._();

  // Favorites — pets the user has hearted
  static List<AdoptionPet> favorites = [
    AdoptionPet(
      id: 'fav1',
      name: 'Miso',
      imageUrls: const ['assets/images/cat_miso_1.png'],
      breed: 'Turkish Angora',
      age: '2 years',
      gender: 'Female',
      location: '3.2 km away',
      description: 'Needs soft meals twice daily while recovering from respiratory treatment.',
      adoptionFee: 0,
      species: 'Cat',
      traits: const ['Quiet soul', 'Window watcher', 'Vaccinated'],
      distance: 3.2,
    ),
    AdoptionPet(
      id: 'fav2',
      name: 'Bramble',
      imageUrls: const ['assets/images/dog_bramble_1.png'],
      breed: 'Mixed shepherd',
      age: '3 years',
      gender: 'Male',
      location: '12.5 km away',
      description: 'Energetic and loving, great with kids.',
      adoptionFee: 0,
      species: 'Dog',
      traits: const ['Playful', 'Friendly', 'Vaccinated'],
      distance: 12.5,
    ),
    AdoptionPet(
      id: 'fav3',
      name: 'Olive',
      imageUrls: const ['assets/images/cat_olive.png'],
      breed: 'Domestic shorthair',
      age: '1 year',
      gender: 'Female',
      location: '28.0 km away',
      description: 'Shy at first, but quickly becomes your shadow.',
      adoptionFee: 0,
      species: 'Cat',
      traits: const ['Shy', 'Indoor only', 'Vaccinated'],
      distance: 28.0,
    ),
  ];

  /// Favorite pet ids currently hearted — starts pre-filled since `favorites`
  /// above is itself "pets the user has hearted". In-memory only.
  static Set<String> favoritePetIds = {for (final p in favorites) p.id};
}
