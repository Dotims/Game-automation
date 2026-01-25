# MargoBot License API

API do zarządzania licencjami bota - hostowane na Vercel, dane w Supabase.

## Deploy na Vercel

1. Zainstaluj Vercel CLI:
```bash
npm i -g vercel
```

2. W folderze `license-api` uruchom:
```bash
vercel login
vercel
```

3. Dodaj zmienne środowiskowe w Vercel Dashboard:
   - `SUPABASE_URL` = `https://uxvbousvsrupyhnwdiim.supabase.co`
   - `SUPABASE_KEY` = **(twój Secret Key z Supabase)**
   - `ADMIN_SECRET` = **(wymyśl silne hasło do generowania licencji)**

4. Redeploy:
```bash
vercel --prod
```

## Endpointy

### POST /api/validate
Walidacja licencji (wywoływane przez bota).
```json
{ "key": "MARGO-XXXXXXXX" }
```

### POST /api/generate
Generowanie nowej licencji (wymaga x-admin-key header).
```json
{ "user": "NazwaUsera", "hours": 720 }
```
