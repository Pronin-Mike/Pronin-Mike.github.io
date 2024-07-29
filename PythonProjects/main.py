import requests

URL = 'https://api.pokemonbattle.ru/v2/'
TOKEN = '5f0a3e25c8f8417f0f9a9792e5808487'
Header = {'Content-Type' : 'application/json', 'trainer_token': TOKEN}
body_create = {
    "name": "Бульбазавр",
    "photo_id": 1
}
body_name = {
    "pokemon_id": "45690",
    "name": "New Name",
    "photo_id": 2
}

body_pokeball = {
    "pokemon_id": "45690"
}
'''response = requests.post(url = f'{URL}pokemons', headers= Header, json= body_create)
print(response.text)'''
'''
response_name = requests.post(url = f'{URL}pokemons', headers= Header, json= body_name)
print(response_name.text)'''

response_pokeball = requests.post(url = f'{URL}trainers/add_pokeball', headers= Header, json= body_pokeball)
print(response_pokeball.text)
'''//Создание покемона
///Смена имени покемона
//Поймать покемона в покебол'''  