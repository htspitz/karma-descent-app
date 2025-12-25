import os
import json
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Firestore imports
from google.cloud import firestore

# =================================================================
# 🚨 P行動 197.1: Firestoreクライアントの初期化を修正 (client -> Client)
# =================================================================
# サービスアカウントキーファイルが環境変数で指定されていることを確認
db = None # 💥 グローバル変数としてdbを初期化
try:
    # 💥 ここが修正点です！firestore.client(database=...) を firestore.Client(database=...) に修正します（Clientの'C'を大文字に）
    db = firestore.Client(database="karmadescent-db")
    print("✅ Firestore Client Initialized with custom database 'karmadescent-db'.")
except Exception as e:
    print(f"❌ Firestore Client Initialization Failed: {e}")
    # データベース接続が失敗した場合、dbはNoneのままになります


# =================================================================
# FastAPIのモデル定義
# =================================================================
class ActionRecord(BaseModel):
    user_id: str
    action_type: str  # 'P' (集中/Positive) or 'N' (浪費/Negative)
    description: str
    weight: int       # 1 to 10
    time_minutes: int # Minutes spent
    emotion: Optional[str] = None # 'Positive', 'Negative', 'Neutral' (N行動の場合のみ)

class ScoreResponse(BaseModel):
    status: str
    total_score: float

class RecordResponse(BaseModel):
    status: str
    score_delta: float

class ActionItem(ActionRecord):
    # timestampの型をstrに変更します。Firestoreから取得されるISOフォーマットの文字列として処理するためです。
    timestamp: str 
    score_delta: float
    
class ListResponse(BaseModel):
    status: str
    actions: list[ActionItem]


# =================================================================
# FastAPIアプリの初期化
# =================================================================
app = FastAPI(title="Karma Descent API")

# CORS設定: 開発環境でアプリからのアクセスを許可
origins = [
    "http://localhost",
    "http://localhost:8081", # Expo Goのデフォルトポート
    "http://192.168.10.114:8000", # あなたのPCのFastAPI URL
    "http://192.168.10.114:8081", # あなたのスマホのExpo Go URL
    "http://192.168.10.103:8081", # ログから確認したスマホのIP
    "http://192.168.10.103:8000",
    "http://192.168.10.114",
    "http://192.168.10.103",
    "*" # 開発中は全て許可
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =================================================================
# P行動：カルマスコア計算ロジック
# =================================================================
def calculate_score_delta(action: ActionRecord) -> float:
    # 基礎点 (時間)
    base_points = action.time_minutes / 10.0 # 30分で3点など

    # 係数 (重み)
    weight_factor = action.weight / 10.0
    
    # 行動タイプによる符号
    sign = 1.0 if action.action_type == 'P' else -1.0
    
    # 感情による調整 (N行動のみ影響)
    emotion_factor = 1.0
    if action.action_type == 'N' and action.emotion:
        if action.emotion == 'Positive': 
            # 浪費でもポジティブな感情(リフレッシュなど)なら少し影響を弱める
            emotion_factor = 0.8
        elif action.emotion == 'Negative': 
            # 浪費でネガティブな感情(後悔、罪悪感)なら影響を強める
            emotion_factor = 1.5
        # 'Neutral' の場合は 1.0 のまま
        
    delta = sign * base_points * weight_factor * emotion_factor
    return round(delta, 2)


# =================================================================
# Firestoreとの連携ロジック
# =================================================================

# データをFirestoreに記録
def save_action_to_firestore(action: ActionRecord, score_delta: float):
    # db接続チェック
    if db is None:
        raise ConnectionError("Database connection not initialized.")

    JST = timezone(timedelta(hours=+9), 'JST')
    timestamp = datetime.now(JST)
    
    record = {
        "user_id": action.user_id,
        "action_type": action.action_type,
        "description": action.description,
        "weight": action.weight,
        "time_minutes": action.time_minutes,
        "emotion": action.emotion,
        "score_delta": score_delta,
        "timestamp": timestamp.isoformat(),
    }
    
    # ユーザーごとのコレクションに保存
    collection_ref = db.collection("actions")
    collection_ref.add(record)
    return record


# 総合スコアを取得
def get_total_score_from_firestore(user_id: str) -> float:
    # db接続チェック
    if db is None:
        raise ConnectionError("Database connection not initialized.")

    # ユーザーIDに一致するすべてのドキュメントを取得
    collection_ref = db.collection("actions")
    # Firestoreのクエリを発行
    query = collection_ref.where("user_id", "==", user_id)
    
    try:
        docs = query.stream()
    except Exception as e:
        # データベースが存在しないなどの致命的なエラーをキャッチ
        print(f"🚨 Firestore query failed: {e}")
        # 呼び出し元にエラーを再スロー
        raise HTTPException(status_code=500, detail=f"Database access error: {e}")

    total_score = 0.0
    # すべてのスコア増減を加算
    for doc in docs:
        data = doc.to_dict()
        if 'score_delta' in data:
            total_score += data['score_delta']
            
    return round(total_score, 2)

# 行動履歴を取得 (最新50件まで)
def get_action_history_from_firestore(user_id: str) -> list[ActionItem]:
    # db接続チェック
    if db is None:
        raise ConnectionError("Database connection not initialized.")

    collection_ref = db.collection("actions")
    # ユーザーIDでフィルタリングし、タイムスタンプの降順でソート（最新を先頭に）
    query = collection_ref.where("user_id", "==", user_id).limit(50)
    
    try:
        docs = query.stream()
    except Exception as e:
        print(f"🚨 Firestore history query failed: {e}")
        # データベースが存在しないなどの致命的なエラーをキャッチ
        raise HTTPException(status_code=500, detail=f"Database access error: {e}")

    actions = []
    for doc in docs:
        data = doc.to_dict()
        # ActionItem Pydanticモデルに合うように変換
        action_item = ActionItem(
            user_id=data.get('user_id'),
            action_type=data.get('action_type'),
            description=data.get('description'),
            weight=data.get('weight'),
            time_minutes=data.get('time_minutes'),
            emotion=data.get('emotion'),
            timestamp=data.get('timestamp'),
            score_delta=data.get('score_delta')
        )
        actions.append(action_item)
        
    # Python側でソート（最新のものを先に）
    # timestampはISO 8601形式の文字列なので、文字列比較で日付順にソートできます。
    actions.sort(key=lambda x: x.timestamp, reverse=True)
    
    # 💥 P行動 199.0: 取得した件数をログに出力し、デバッグを助けます
    print(f"💡 History fetched for user {user_id}: {len(actions)} records found.")

    return actions


# =================================================================
# FastAPI エンドポイント定義
# =================================================================

# 1. 行動記録エンドポイント (POST)
@app.post("/api/action/record", response_model=RecordResponse)
async def record_action(action: ActionRecord):
    # スコア増減を計算
    score_delta = calculate_score_delta(action)
    
    # Firestoreに保存
    try:
        save_action_to_firestore(action, score_delta)
    except ConnectionError as ce:
        print(f"🚨 Failed due to connection error: {ce}")
        raise HTTPException(status_code=500, detail="Database connection failed during save.")
    except Exception as e:
        print(f"🚨 Failed to save to Firestore: {e}")
        raise HTTPException(status_code=500, detail="Failed to save data to Firestore.")
    
    return RecordResponse(status="success", score_delta=score_delta)

# 2. 総合スコア取得エンドポイント (GET)
@app.get("/api/karma/score/{user_id}", response_model=ScoreResponse)
async def get_karma_score(user_id: str):
    try:
        total_score = get_total_score_from_firestore(user_id)
    except ConnectionError as ce:
        print(f"🚨 Failed due to connection error: {ce}")
        raise HTTPException(status_code=500, detail="Database connection failed during fetch.")
    except HTTPException as e:
        # Firestoreアクセスエラー（500）をそのまま返す
        raise e
    except Exception as e:
        # その他の予期せぬエラー
        print(f"🚨 An unexpected error occurred: {e}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred while fetching the score.")
        
    return ScoreResponse(status="success", total_score=total_score)

# 3. 行動履歴取得エンドポイント (GET)
@app.get("/api/action/list/{user_id}", response_model=ListResponse)
async def get_action_list(user_id: str):
    try:
        actions = get_action_history_from_firestore(user_id)
    except ConnectionError as ce:
        print(f"🚨 Failed due to connection error: {ce}")
        raise HTTPException(status_code=500, detail="Database connection failed during history fetch.")
    except HTTPException as e:
        # Firestoreアクセスエラー（500）をそのまま返す
        raise e
    except Exception as e:
        # その他の予期せぬエラー
        print(f"🚨 An unexpected error occurred while fetching action history: {e}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred while fetching action history.")

    return ListResponse(status="success", actions=actions)
