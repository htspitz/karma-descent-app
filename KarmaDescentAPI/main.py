"""
FastAPI セキュリティ認証システムとカルマロジックの統合

JWT認証を必須とし、認証されたユーザーのみが
カルマ記録エンドポイントにアクセスできる論理回路です。
"""
from fastapi import FastAPI, Depends, HTTPException, status, APIRouter
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

# --- 1. 基本設定（セキュリティ関連） ---
SECRET_KEY = "THIS_IS_A_VERY_LONG_AND_RANDOM_STRING_FOR_JWT_SIGNING_2025_SEPTEMBER"  # あなたが設定した秘密鍵
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- 2. Pydantic モデル（情報の構造化） ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class User(BaseModel):
    username: str
    full_name: Optional[str] = None
    # ユーザーが認証された後にアクセスできる追加情報
    is_authenticated: bool = True 

class KarmaRecord(BaseModel):
    """ユーザーが記録するカルマ情報の論理構造 (JWT認証用)"""
    title: str = Field(..., max_length=100, description="P行動または陰の行動のタイトル")
    value: int = Field(..., description="行動の評価値 (例: 陽 +10, 陰 -5)")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="記録された日時")

# --- 3. ユーザー認証のダミーデータと関数 ---
DUMMY_USERS_DB = {
    "user_alpha": {
        "username": "user_alpha",
        "password": "password123",
        "full_name": "Rikako-sensei",
    }
}

def get_user(db, username: str):
    if username in db:
        return db[username]
    return None

def authenticate_user(username: str, password: str):
    user = get_user(DUMMY_USERS_DB, username)
    if not user or user["password"] != password: 
        return False
    return user

# --- 4. JWTエンコード/デコードロジック（再利用） ---
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_token(token: str, credentials_exception):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        return TokenData(username=username)
    except JWTError:
        raise credentials_exception

async def get_current_user(token: str = Depends(oauth2_scheme)):
    """JWTトークン検証と現在のユーザー取得を行う依存性関数"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="認証情報が無効です",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token_data = verify_token(token, credentials_exception)
    user = get_user(DUMMY_USERS_DB, token_data.username)
    if user is None:
        raise credentials_exception
    # Userモデルにis_authenticatedを含めることで、認証が成功したことを明示
    return User(username=user["username"], full_name=user["full_name"], is_authenticated=True)

# --- 5. アプリケーションとルーターの定義 ---
app = FastAPI(title="情報制御システム（タイムマシン・プロトタイプ）")

# カルマロジック専用のルーターを定義 (JWT認証必須)
karma_router = APIRouter(
    prefix="/karma",
    tags=["カルマ記録 (JWT認証必須)"],
    # このルーター内のすべてのエンドポイントで認証を必須とする
    dependencies=[Depends(get_current_user)] 
)

# 認証ロジックを直接appに追加
@app.post("/token", response_model=Token, tags=["認証"])
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    ログインエンドポイント: アクセストークンを発行する
    """
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ユーザー名またはパスワードが正しくありません",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        data={"sub": user["username"]}, 
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "token_type": "bearer"}

# ユーザー情報エンドポイント
@app.get("/users/me", response_model=User, tags=["認証"])
async def read_users_me(current_user: User = Depends(get_current_user)):
    """
    保護されたエンドポイント: 認証済みユーザーの情報を返す
    """
    return current_user

# --- 6. JWT認証必須のカルマロジックエンドポイント（ダミーDB使用） ---
# JWT認証用のダミーDB
KARMA_JWT_DB: List[KarmaRecord] = []

@karma_router.post("/record", response_model=KarmaRecord)
async def record_karma(
    record: KarmaRecord, 
    current_user: User = Depends(get_current_user) # 認証済みのユーザー情報を使用
):
    """
    新しいカルマ行動を記録する（陽の行動の記録）
    """
    KARMA_JWT_DB.append(record)
    print(f"ユーザー {current_user.username} がJWT認証でカルマを記録: {record.title}, 値: {record.value}")
    
    return record

@karma_router.get("/history", response_model=List[KarmaRecord])
async def get_karma_history(
    current_user: User = Depends(get_current_user)
):
    """
    カルマの履歴を取得する
    """
    return KARMA_JWT_DB


# =======================================================
# --- 7. モバイルアプリ連携用 API エンドポイント (App.jsとの通信用) ---
# モバイルアプリが期待するパス構造（/api/action/list/{user_id}など）に合わせたルーター
# JWT認証は使用しない (一時的なプロトタイプ連携用)

# **データ永続化のための簡易DB構造 (ユーザーIDをキーとするディクショナリ)**
# { user_id: [ {record1}, {record2}, ... ], ... }
KARMA_APP_DB: Dict[str, List[Dict[str, Any]]] = {}

# Pydanticモデル (App.jsに合わせる)
class AppRecord(BaseModel):
    user_id: str
    action_type: str
    description: str
    weight: int
    time_minutes: int
    emotion: Optional[str] = None

api_router = APIRouter(
    prefix="/api",
    tags=["モバイル連携 (非認証プロトタイプ)"],
)

# App.jsが期待するスコア取得パスに対応
@api_router.get("/karma/score/{user_id}")
async def get_total_karma_score_for_app(user_id: str):
    """モバイルアプリ用: 総合スコアを取得 (永続化ロジック適用)"""
    
    user_actions = KARMA_APP_DB.get(user_id, [])
    
    # 総合スコアを計算
    total_score = 0
    for action in user_actions:
        # P行動はプラス、N行動はマイナスとして計算
        modifier = 1 if action.get('action_type') == 'P' else -1
        total_score += action.get('weight', 0) * modifier
    
    print(f"ユーザーID {user_id} のスコア計算完了。合計: {total_score}")
    
    return {"status": "success", "total_score": total_score}

# App.jsが期待する履歴取得パスに対応
@api_router.get("/action/list/{user_id}")
async def get_karma_history_for_app(user_id: str):
    """モバイルアプリ用: 行動履歴を取得 (永続化ロジック適用)"""
    
    # ユーザーIDに紐づく履歴を取得。なければ空のリストを返す
    user_actions = KARMA_APP_DB.get(user_id, [])
    
    print(f"ユーザーID {user_id} の履歴取得リクエストを受信。{len(user_actions)}件のデータを返します。")
    
    # モバイルアプリはリスト内の要素を 'actions' キーで期待している
    return {"status": "success", "actions": user_actions}

# App.jsが期待する記録パスに対応
@api_router.post("/action/record")
async def record_app_action(record: AppRecord):
    """モバイルアプリ用: 行動を記録 (永続化ロジック適用)"""
    
    # 記録データからスコアの増分を計算
    score_delta = record.weight * (1 if record.action_type == 'P' else -1)

    # 記録データを辞書形式に変換し、タイムスタンプを追加
    action_data = record.dict()
    action_data["score_delta"] = score_delta
    action_data["timestamp"] = datetime.utcnow().isoformat()
    
    # 簡易DBに保存（ユーザーIDでグルーピング）
    if record.user_id not in KARMA_APP_DB:
        KARMA_APP_DB[record.user_id] = []
        
    KARMA_APP_DB[record.user_id].append(action_data)

    print(f"ユーザーID {record.user_id} がアプリから行動を記録: {record.description} (スコア増分: {score_delta})")

    # App.jsが期待するレスポンスを返す
    return action_data


# ルーターをメインアプリに組み込む
app.include_router(karma_router) # JWT認証付きのパス
app.include_router(api_router)   # モバイルアプリ連携用のパス
