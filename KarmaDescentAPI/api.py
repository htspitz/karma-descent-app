import os
import json
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
# run_in_threadpool をインポート
from fastapi import FastAPI, HTTPException, Body, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import firestore
from google.oauth2 import service_account
# run_in_threadpool をインポート
from starlette.concurrency import run_in_threadpool 

# 認証ヘルパーは一旦コメントアウト。ここでは使われていません。
# from firebase_auth import get_current_user 

# =================================================================
# Firebase/Firestore初期化
# =================================================================

# 🔥 修正箇所 START: 初期化ロジックを変更
try:
    # 🚨 【修正ポイント】ここで使用したいプロジェクトIDを直接指定します
    PROJECT_ID = "karmadescent-backend-2396e" 
    # 💡 【重要】画像から読み取れるデータベース名を指定します
    DATABASE_NAME = "karmadescent-db" 
    
    # ServiceAccountKeyのJSONファイルを読み込む (認証情報)
    SERVICE_ACCOUNT_KEY_PATH = r"C:\Users\user\Documents\karma_mobile\KarmaDescentAPI\serviceAccountKey.json"
    
    if os.path.exists(SERVICE_ACCOUNT_KEY_PATH):
        # 認証情報ファイルから認証情報をロード
        cred = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_KEY_PATH)
        # 指定したプロジェクトIDと認証情報、そしてデータベース名を使用してFirestoreクライアントを初期化
        # 🔥 修正点：database=DATABASE_NAME を追加
        db = firestore.Client(credentials=cred, project=PROJECT_ID, database=DATABASE_NAME)
        
    else:
        # 環境変数に依存して初期化（サービスアカウントキーが見つからない場合）
        # 🔥 修正点：database=DATABASE_NAME を追加
        db = firestore.Client(project=PROJECT_ID, database=DATABASE_NAME)
        
    print(f"✅ Firestore ClientがプロジェクトID: {PROJECT_ID}, データベース: {DATABASE_NAME} で正常に初期化されました。")
except Exception as e:
    print(f"❌ Firestore Clientの初期化中にエラーが発生しました: {e}")
    # 初期化に失敗した場合、dbをNoneにしておき、各エンドポイントでチェックする
    db = None
# 🔥 修正箇所 END

# =================================================================
# Pydantic モデル定義
# =================================================================

class ActionRecord(BaseModel):
    user_id: str
    action_type: str # 'P' (Positive) または 'N' (Negative)
    description: str
    weight: int       # 1-10の困難度・重要度
    time_minutes: int # 集中時間/浪費時間
    emotion: Optional[str] = None # 'N'行動の場合の感情 ('Positive', 'Negative', 'Neutral')


class ActionItem(ActionRecord):
    id: str
    score_delta: float
    timestamp: datetime


class KarmaHistoryItem(BaseModel):
    timestamp: datetime
    score: float
    action_type: str

class ApiResponse(BaseModel):
    status: str
    message: Optional[str] = None
    total_score: Optional[float] = None
    actions: Optional[List[ActionItem]] = None
    history: Optional[List[KarmaHistoryItem]] = None

# =================================================================
# FastAPI初期化とCORS設定
# =================================================================
app = FastAPI()

# 💡 APIRouterを導入し、すべてのエンドポイントをここに定義します
router = APIRouter(prefix="/api")

# CORS設定：ローカルの開発環境からのアクセスを許可
origins = [
    "http://localhost",
    "http://localhost:8081", # React Native Metro Bundlerからのアクセスを許可
    "http://192.168.10.114:8081", # アプリからのアクセスを許可
    # 🚨 【最重要 N 行動】ここにあなたのPCのローカルIPアドレスを追加
    "http://192.168.10.114:8000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =================================================================
# ユーティリティ関数
# =================================================================

def calculate_score_delta(action: ActionRecord) -> float:
    """行動タイプ、重み、時間に基づいてスコアの変化量を計算する"""
    base_score = action.weight * (action.time_minutes / 60.0) # 時間を考慮
    
    if action.action_type == 'P':
        # P行動は常にプラス
        return round(base_score * 10, 2)
    
    elif action.action_type == 'N':
        # N行動は常にマイナス。感情によってペナルティを加える
        penalty_multiplier = 1.0
        if action.emotion == 'Negative':
            penalty_multiplier = 1.5 # ネガティブな感情のN行動はペナルティ大
        elif action.emotion == 'Positive':
            penalty_multiplier = 0.5 # 楽しいN行動はペナルティ小 (休憩とみなせる)
        
        return round(-base_score * 10 * penalty_multiplier, 2)
        
    return 0.0
    
# 🔥 トランザクション処理を同期的に実行し、メインスレッドで await するためのヘルパー
async def async_transactional_update(user_score_ref, score_delta, record):
    """同期Firestoreトランザクションを非同期で実行する"""
    
    # トランザクション関数（同期実行）
    @firestore.transactional
    def update_score_transaction(transaction, user_score_ref, score_delta):
        snapshot = user_score_ref.get(transaction=transaction) # 同期get
        current_score = snapshot.get('total_score') if snapshot.exists else 0.0
        new_score = current_score + score_delta
        
        # スコア更新
        transaction.set(user_score_ref, {'total_score': new_score}, merge=True)

        # karma_historyコレクションに累積スコアを記録
        history_data = {
            'timestamp': datetime.utcnow(),
            'score': new_score,
            'action_type': record.action_type
        }
        history_ref = db.collection(f'karma_history_{record.user_id}').document()
        transaction.set(history_ref, history_data)
        
        return new_score

    # run_in_threadpool でトランザクションを非同期的に実行
    transaction = db.transaction()
    # run_in_threadpool の引数を修正
    new_score = await run_in_threadpool(update_score_transaction, transaction, user_score_ref, score_delta)
    return new_score

# =================================================================
# エンドポイント (ルーターを使用)
# =================================================================

@app.get("/")
def read_root():
    """ルートエンドポイント：サーバー稼働確認用"""
    return {"message": "Karma Descent API is running successfully!", "firestore_status": "Connected" if db else "Disconnected"}


@router.get("/karma/history_data/{user_id}") 
async def get_karma_history(user_id: str) -> ApiResponse:
    """
    累積スコアの推移履歴を取得する (グラフ表示用)
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database connection error.")
        
    try:
        # 古いものから順に100件取得
        query = db.collection(f'karma_history_{user_id}').order_by('timestamp', direction='ASCENDING').limit(100)
        
        # 🔥 修正: 同期メソッドを run_in_threadpool でラップ
        docs = await run_in_threadpool(query.get)

        history_items = []
        for doc in docs:
            data = doc.to_dict()
            # FirestoreのTimestampオブジェクトをPythonのdatetimeに変換
            timestamp = data.get('timestamp').to_datetime() if hasattr(data.get('timestamp'), 'to_datetime') else data.get('timestamp')
            
            history_items.append(KarmaHistoryItem(
                timestamp=timestamp,
                score=data.get('score', 0.0),
                action_type=data.get('action_type', 'P')
            ))
        
        print(f"LOG: Successfully fetched {len(history_items)} karma history items for user {user_id}")
        return ApiResponse(status="success", history=history_items)

    except Exception as e:
        print(f"Error fetching karma history: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch karma history: {e}")


@router.get("/karma/score/{user_id}")
async def get_total_score(user_id: str) -> ApiResponse:
    """現在の総合カルマスコアを取得する"""
    if db is None:
        raise HTTPException(status_code=503, detail="Database connection error.")
        
    try:
        doc_ref = db.collection('user_scores').document(user_id)
        
        # 🔥 修正: 同期メソッドを run_in_threadpool でラップ
        doc = await run_in_threadpool(doc_ref.get)

        if doc.exists:
            total_score = doc.to_dict().get('total_score', 0.0)
            return ApiResponse(status="success", total_score=total_score)
        else:
            return ApiResponse(status="success", total_score=0.0)
            
    except Exception as e:
        print(f"Error fetching score: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch score: {e}")


@router.post("/action/record")
async def record_action(record: ActionRecord = Body(...)) -> ApiResponse:
    """P行動またはN行動の記録を受け付け、スコアを更新する"""
    if db is None:
        raise HTTPException(status_code=503, detail="Database connection error.")
        
    score_delta = calculate_score_delta(record)
    
    try:
        # 1. user_actionsコレクションに行動を記録 (setもrun_in_threadpoolで実行)
        action_data = record.dict()
        action_data['score_delta'] = score_delta
        action_data['timestamp'] = datetime.utcnow()
        
        action_ref = db.collection(f'user_actions_{record.user_id}').document()
        # 🔥 修正: 同期メソッドを run_in_threadpool でラップ
        await run_in_threadpool(action_ref.set, action_data)
        
        # 2. user_scoresコレクションの総合スコアを更新 (トランザクションはヘルパー関数を使用)
        user_score_ref = db.collection('user_scores').document(record.user_id)
        
        # 🔥 修正: トランザクションを非同期ヘルパーで実行
        new_score = await async_transactional_update(user_score_ref, score_delta, record)

        return ApiResponse(
            status="success",
            message=f"Action recorded. Score changed by {score_delta:.2f}. New score: {new_score:.2f}",
            total_score=new_score
        )

    except Exception as e:
        print(f"Error recording action: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to record action: {e}")


@router.get("/action/list/{user_id}")
async def list_actions(user_id: str) -> ApiResponse:
    """ユーザーの行動履歴リストを最新の100件取得する"""
    if db is None:
        raise HTTPException(status_code=503, detail="Database connection error.")

    try:
        # 最新の100件を取得
        query = db.collection(f'user_actions_{user_id}').order_by('timestamp', direction='DESCENDING').limit(100)
        
        # 🔥 修正: 同期メソッドを run_in_threadpool でラップ
        docs = await run_in_threadpool(query.get)
        
        actions = []
        for doc in docs:
            data = doc.to_dict()
            # FirestoreのTimestampオブジェクトをPythonのdatetimeに変換
            timestamp = data.get('timestamp').to_datetime() if hasattr(data.get('timestamp'), 'to_datetime') else data.get('timestamp')

            actions.append(ActionItem(
                id=doc.id,
                # 🔥 修正点: user_id は URL パスから取得した値を使用する
                user_id=user_id,
                action_type=data.get('action_type', 'P'),
                description=data.get('description', 'N/A'),
                weight=data.get('weight', 5),
                time_minutes=data.get('time_minutes', 30),
                emotion=data.get('emotion'),
                score_delta=data.get('score_delta', 0.0),
                timestamp=timestamp
            ))
            
        return ApiResponse(status="success", actions=actions)

    except Exception as e:
        print(f"Error listing actions: {e}")
        # 🚨 Pydanticバリデーションエラーが発生した場合、詳細を分かりやすく表示する
        # e.g., PydanticValidationError
        if hasattr(e, 'errors'):
             raise HTTPException(status_code=500, detail=f"Failed to list actions: Pydantic Validation Error - {e.errors()}")
        else:
             raise HTTPException(status_code=500, detail=f"Failed to list actions: {e}")

# 🔥 メインのFastAPIアプリケーションにルーターを含める
app.include_router(router)
