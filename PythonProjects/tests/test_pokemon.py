import requests
import pytest

URL = 'https://api.pokemonbattle.ru/v2/'
TOKEN = '5f0a3e25c8f8417f0f9a9792e5808487'
Header = {'Content-Type' : 'application/json', 'trainer_token': TOKEN}

def test_status_code():
    response = requests.get(url = f'{URL}trainers', params= {'trainer_id' : 4577})
    assert response.status_code == 200


"""- Проверь, что ответ запрос **GET /trainers** приходит с кодом 200
- Проверь, что в ответе приходит строчка с именем твоего тренера
(Не забудь прописать в **квери** id твоего тренера (`trainer_id`))"""