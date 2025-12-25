import firebase_admin
from firebase_admin import credentials, auth
from typing import Optional
from fastapi import Header, HTTPException

# 🚨 【最重要 P 行動】サービスアカウントキーのパスに置き換えてください
# FirebaseコンソールからダウンロードしたJSONファイルのパスを指定する必要があります。
# Windowsの絶対パスを安全に扱うため、r'' (Raw文字列)を使用します。
SERVICE_ACCOUNT_KEY_PATH = r"C:\Users\user\Documents\karma_mobile\KarmaDescentAPI\serviceAccountKey.json"

# Firebase Admin SDKの初期化
try:
    # サービスアカウントキーを読み込む
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY_PATH)
    
    # 既に初期化されているかチェックしてから初期化
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
        # 修正: メッセージを文字列として囲む
        print("✅ Firebase Admin SDKが正常に初期化されました。")
    
except FileNotFoundError:
    # 修正: メッセージを文字列として囲む
    print(f"❌ サービスアカウントキーが見つかりません: {SERVICE_ACCOUNT_KEY_PATH}")
    print("⚠️ 認証機能は無効です。Firestore接続はapi.py側で初期化されています。")
except Exception as e:
    # 修正: メッセージを文字列として囲む
    print(f"❌ Firebase Admin SDKの初期化中にエラーが発生しました: {e}")
    
    
# 認証依存性関数 (api.pyでインポートエラーを解消するために必要)
async def get_current_user(authorization: Optional[str] = Header(None)):
    """
    認証ヘッダーからユーザーIDを取得する関数。
    現在はapi.pyのimportエラーを解消するために定義したプレースホルダーです。
    """
    # 現時点では認証なしで進むため、常にNoneを返します。（API側はuser_idをURLパスから取得）
    return None 
