# MovieVerse

Django movie discovery web app with TMDB API integration, user authentication, and favorites.

**Live:** https://markand.pythonanywhere.com

## Tech Stack

| Technology | Use |
|------------|-----|
| **Django 6** | Backend framework — routes, views, models, auth |
| **SQLite** | Database — movies, users, favorites, cast, contact messages |
| **TMDB API** | External movie data — search, details, cast, trailers, actor info |
| **HTML/CSS/JS** | Frontend templates and styling |
| **PythonAnywhere** | Production hosting |
| **python-dotenv** | `.env` file thi secret keys load karva |
| **requests** | TMDB API HTTP calls |
| **Pillow** | Movie poster images handle karva |

## Local Setup

```powershell
cd "C:\Users\khushi\OneDrive\Desktop\the mark\movie_project"
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# .env me TMDB_API_KEY set karo
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

## PythonAnywhere Deploy

1. Code GitHub par push karo
2. PythonAnywhere → **Web** → WSGI file set karo: `movie.wsgi.application`
3. **Virtualenv** path set karo ane `pip install -r requirements.txt`
4. Bash console ma:
   ```bash
   python manage.py migrate
   python manage.py collectstatic
   ```
5. **Static files** mapping: `/static/` → `staticfiles/` folder
6. **Media files** mapping: `/media/` → `media/` folder

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | Django secret key |
| `DEBUG` | `True` local, `False` production |
| `TMDB_API_KEY` | TMDB API key |

Built by Markand
