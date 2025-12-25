import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, View, TextInput, Alert, ScrollView, TouchableOpacity, Modal, Dimensions } from 'react-native';
import axios from 'axios';
// getApps をインポートに追加
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously, User } from "firebase/auth"; 
import { ActivityIndicator } from 'react-native'; 

// ChartKitのコンセプトを適用するための定数とヘルパー関数
const { width: screenWidth } = Dimensions.get('window');
const CHART_HEIGHT = 200; // グラフの高さを固定

// 🚨 【最重要 P 行動】ここにあなたのFirebase設定を貼り付けてください
// ⚠️ 修正点：APIキーを""（空の文字列）に戻します。
const firebaseConfig = {
  apiKey: "", 
  authDomain: "karmadescent-backend-2396e.firebaseapp.com",
  projectId: "karmadescent-backend-2396e",
  storageBucket: "karmadescent-backend-2396e.firebasestorage.app",
  messagingSenderId: "517440006213",
  appId: "1:517440006213:web:c8af89e2071ff714cddb2c",
  measurementId: "G-WC98SM3BLF"
};

// 🚨 二重初期化を防止するためのチェック
// Firebaseを初期化
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app); 

// サーバーのIPアドレスを設定（あなたのFastAPIのIPに置き換えてください）
const API_BASE_URL = 'http://192.168.10.114:8000'; 

// 行動履歴の型定義 (IDが必須になりました)
interface ActionItem {
  id: string; // 🚨 サーバー側の修正に合わせてIDを追加
  user_id: string;
  action_type: 'P' | 'N';
  description: string;
  weight: number;
  time_minutes: number;
  emotion: string | null;
  timestamp: string;
  score_delta: number; // これがundefinedになる可能性がある
}

// グラフデータの型定義 (累積スコアとタイムスタンプ)
interface KarmaHistoryItem {
  timestamp: string;
  score: number; // 累積スコア
  delta: number; // この行動によるスコア変化
  action_type: 'P' | 'N';
}

// =================================================================
// ユーティリティ関数
// =================================================================

/** スコアを取得してStateを更新する */
const fetchTotalScore = async (user: User, setTotalScore: React.Dispatch<React.SetStateAction<number | null>>) => {
  const userId = user.uid;
  const url = `${API_BASE_URL}/api/karma/score/${userId}`;

  try {
    console.log(`LOG 【P行動:API呼出】GET ${url} (非認証)`);
    const response = await axios.get(url);
    const responseData = response.data;
    
    if (responseData && responseData.status === 'success' && typeof responseData.total_score === 'number') {
      setTotalScore(responseData.total_score);
    } else {
       // APIからの応答が不正な場合は、total_scoreをnullにしてロード画面に戻す
       setTotalScore(null);
       throw new Error("Invalid API response structure for score. total_score is missing or not a number.");
    }
  } catch (error) {
    console.error('ERROR 🚨 スコア取得の最終エラー:', error);
    setTotalScore(null);
  }
};

/** 履歴と累積スコア履歴を取得する */
const fetchAllHistory = async (
  user: User, 
  setActionHistory: React.Dispatch<React.SetStateAction<ActionItem[]>>,
  setKarmaHistory: React.Dispatch<React.SetStateAction<KarmaHistoryItem[]>>,
  setTotalScore: React.Dispatch<React.SetStateAction<number | null>>
) => {
  const userId = user.uid;
  try {
    // 履歴リストの取得
    const listUrl = `${API_BASE_URL}/api/action/list/${userId}`;
    console.log(`LOG 【P行動:API呼出】GET ${listUrl} (非認証)`);
    const listResponse = await axios.get(listUrl);
    const listData = listResponse.data;
    if (listData && listData.status === 'success' && Array.isArray(listData.actions)) {
      // 🚨 IDがないレコードにIDを付与する簡易処理 (サーバー側でID管理が必須)
      const actionsWithId: ActionItem[] = listData.actions.map((action: any, index: number) => ({
        ...action,
        // 🚨 ここが重要：サーバーからIDが来ていればそれを使う。なければ暫定ID。
        id: action.id || `mock-${index}-${Date.now()}` 
      }));
      setActionHistory(actionsWithId);
    } else {
      throw new Error("Invalid API response structure for action list.");
    }

    // 累積スコア履歴の取得（サーバー側の実装がないため、フロント側でシミュレーション）
    const simulatedKarmaHistory: KarmaHistoryItem[] = [];
    let cumulativeScore = 0;
    
    // タイムスタンプでソートして正確な累積値を計算
    listData.actions.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    listData.actions.forEach((action: any) => {
        const weight = typeof action.weight === 'number' ? action.weight : 0;
        const scoreDelta = weight * (action.action_type === 'P' ? 1 : -1);
        
        cumulativeScore += scoreDelta;
        simulatedKarmaHistory.push({
            timestamp: action.timestamp,
            score: cumulativeScore,
            delta: scoreDelta,
            action_type: action.action_type
        });
    });
    
    setKarmaHistory(simulatedKarmaHistory);

    // 履歴が正常に取得されたら、最新の累積スコアをトータルスコアとして設定する
    if (simulatedKarmaHistory.length > 0) {
      setTotalScore(simulatedKarmaHistory[simulatedKarmaHistory.length - 1].score);
    } else {
      setTotalScore(0);
    }
    
    console.log(`LOG 【P行動:履歴取得成功】${listData.actions.length}件の履歴を取得しました。`);
  } catch (error) {
    console.error('ERROR 🚨 履歴取得の最終エラー:', error);
    setActionHistory([]);
    setKarmaHistory([]);
    setTotalScore(null);
  }
};


// =================================================================
// メインコンポーネント
// =================================================================
export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null); 
  const [actionType, setActionType] = useState<'P' | 'N'>('P');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState(5);
  const [timeMinutes, setTimeMinutes] = useState(30);
  const [emotion, setEmotion] = useState<string | null>(null);
  const [totalScore, setTotalScore] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionHistory, setActionHistory] = useState<ActionItem[]>([]); 
  const [karmaHistory, setKarmaHistory] = useState<KarmaHistoryItem[]>([]); 

  // 編集モーダル用のState (中略)
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingAction, setEditingAction] = useState<ActionItem | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editWeight, setEditWeight] = useState(5);
  const [editTimeMinutes, setEditTimeMinutes] = useState(30);
  const [editEmotion, setEditEmotion] = useState<string | null>(null);
  const [editActionType, setEditActionType] = useState<'P' | 'N'>('P');

  // データ再取得のためのコールバックを定義
  const refreshData = useCallback(async (user: User) => {
    await fetchAllHistory(user, setActionHistory, setKarmaHistory, setTotalScore);
  }, []);

  // --- ユーティリティ関数 ---
  
  /** 行動を記録する */
  const handleRecordAction = async () => {
    if (!firebaseUser) {
      Alert.alert('エラー', 'ユーザー認証が完了していません。');
      return;
    }
    if (!description.trim()) {
      Alert.alert('エラー', '行動内容を入力してください。');
      return;
    }
    
    const actionData = {
      user_id: firebaseUser.uid, 
      action_type: actionType,
      description: description.trim(),
      weight: Math.min(10, Math.max(1, weight)), 
      time_minutes: Math.max(0, timeMinutes),
      emotion: actionType === 'N' ? emotion : null,
    };

    try {
      const url = `${API_BASE_URL}/api/action/record`;
      console.log(`LOG 【P行動:API呼出】POST ${url} (非認証)`);

      const response = await axios.post(url, actionData, {
        headers: { 'Content-Type': 'application/json' },
      });

      const responseData: ActionItem = response.data; 

      // 🚨 【toFixedエラー修正済】 score_delta が数値であることを確認してから toFixed を使用
      const scoreDeltaText = typeof responseData.score_delta === 'number'
        ? responseData.score_delta.toFixed(2)
        : '（計算中）'; // サーバーから値が返ってこなかった場合

      Alert.alert('記録完了', `${actionType}行動を記録しました！\nスコア増減: ${scoreDeltaText}`);
      
      // データをリセット
      setDescription('');
      setWeight(5);
      setTimeMinutes(30);
      setEmotion(null);
      
      // スコアと履歴を更新
      await refreshData(firebaseUser); 

    } catch (error) {
      console.error('ERROR 🚨 記録処理の最終エラー', error);
      Alert.alert('エラー', 'サーバーからの応答に問題がありました。');
    }
  };

  /** 編集ボタンを押したときの処理 (中略) */
  const openEditModal = (action: ActionItem) => {
    setEditingAction(action);
    setEditActionType(action.action_type);
    setEditDescription(action.description);
    setEditWeight(action.weight);
    setEditTimeMinutes(action.time_minutes);
    setEditEmotion(action.emotion || (action.action_type === 'N' ? 'Neutral' : null));
    setIsModalVisible(true);
  };

  /** 編集内容をサーバーに送信する (中略) */
  const handleUpdateAction = async () => {
    if (!firebaseUser || !editingAction) return;
    if (!editDescription.trim()) {
      Alert.alert('エラー', '行動内容を入力してください。');
      return;
    }

    const updateData = {
      action_type: editActionType,
      description: editDescription.trim(),
      weight: Math.min(10, Math.max(1, editWeight)), 
      time_minutes: Math.max(0, editTimeMinutes),
      emotion: editActionType === 'N' ? editEmotion : null,
    };

    try {
      const url = `${API_BASE_URL}/api/action/update/${firebaseUser.uid}/${editingAction.id}`; 
      console.log(`LOG 【P行動:API呼出】PUT ${url} (非認証)`);

      const response = await axios.put(url, updateData, {
        headers: { 'Content-Type': 'application/json' },
      });

      const responseData: ActionItem = response.data; 

      const scoreDeltaText = typeof responseData.score_delta === 'number'
        ? responseData.score_delta.toFixed(2)
        : '（再計算中）';

      Alert.alert('更新完了', `行動ID ${responseData.id} を更新しました。\nスコア再計算: ${scoreDeltaText}`);
      setIsModalVisible(false);
      
      await refreshData(firebaseUser); 

    } catch (error) {
      console.error('ERROR 🚨 更新処理の最終エラー', error);
      Alert.alert('エラー', '行動の更新に失敗しました。サーバー側の再計算ロジックを確認してください。');
    }
  };

  /** 行動を削除する (中略) */
  const handleDeleteAction = (actionId: string) => {
    if (!firebaseUser) return;

    Alert.alert(
      "行動を削除",
      "この行動記録を完全に削除しますか？スコアに影響します。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除する",
          style: "destructive",
          onPress: async () => {
            try {
              const url = `${API_BASE_URL}/api/action/delete/${firebaseUser.uid}/${actionId}`;
              console.log(`LOG 【P行動:API呼出】DELETE ${url} (非認証)`);

              await axios.delete(url);

              Alert.alert('削除完了', '行動記録を削除しました。');
              
              await refreshData(firebaseUser); 

            } catch (error) {
              console.error('ERROR 🚨 削除処理の最終エラー', error);
              Alert.alert('エラー', '行動の削除に失敗しました。');
            }
          }
        },
      ]
    );
  };


  // --- 初期ロードと認証 (useEffect) ---
  useEffect(() => {
    const initializeApp = async () => {
      setIsLoading(true);
      try {
        console.log('LOG 【P行動:認証】匿名認証を開始します。');
        const userCredential = await signInAnonymously(auth);
        const user = userCredential.user;
        setFirebaseUser(user);
        
        console.log('LOG 【P行動:認証】匿名認証成功。UID:', user.uid);

        await refreshData(user);

      } catch (error) {
        Alert.alert('認証失敗', `Firebase認証に失敗しました。エラー: ${error}`);
        console.error('ERROR 🚨 初期認証失敗:', error);
      } finally {
        setIsLoading(false);
        console.log('LOG 【P行動】初期化完了。ロード画面を解除します。');
      }
    };

    initializeApp();
  }, [refreshData]); 


  if (isLoading || totalScore === null || !firebaseUser) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.loadingText}>{!firebaseUser ? '認証中...' : 'カルマデータをロード中...'}</Text>
      </View>
    );
  }

  // スコアの表示色を動的に設定
  const scoreColor = totalScore >= 0
    ? (totalScore > 50 ? '#10B981' : '#34D399')
    : (totalScore < -50 ? '#EF4444' : '#F87171');

  const scoreText = totalScore.toFixed(2);
  const quickWeights = [1, 3, 5, 8, 10];


  // 累積スコアグラフのレンダリング (折れ線グラフの実装)
  const renderKarmaChart = () => {
    if (karmaHistory.length === 0) {
      return (
        <View style={styles.chartContainer}>
          <Text style={styles.chartTitle}>カルマスコア推移</Text>
          <View style={styles.noChartData}>
             <Text style={styles.noHistoryText}>行動を記録すると、折れ線グラフが表示されます。</Text>
          </View>
        </View>
      );
    }
    
    const scores = karmaHistory.map(item => item.score);
    
    // 💡 1. 平均スコアを計算 (reduceの活用)
    const totalScoreSum = scores.reduce((sum, score) => sum + score, 0);
    const avgScore = totalScoreSum / scores.length;

    // スコア範囲の計算 (グラフのスケールを決定)
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const scoreRange = maxScore - minScore === 0 ? 1 : maxScore - minScore;
    
    // グラフの左と右のパディング
    const PADDING_HORIZONTAL = 20; 
    
    // データポイント間のX軸間隔
    const pointCount = scores.length;
    const stepX = (screenWidth - 40 - PADDING_HORIZONTAL * 2) / (pointCount - 1 || 1); 

    // グラフのデータポイントとラインパスを計算
    const chartPoints = karmaHistory.map((item, index) => {
      // X座標: 左端 + 間隔 * index
      const x = PADDING_HORIZONTAL + index * stepX;
      // Y座標: スケーリングと反転 (int -> ピクセル変換)
      const y = CHART_HEIGHT * (1 - (item.score - minScore) / scoreRange); 
      return { x, y, score: item.score, id: item.timestamp }; // 🚨 key 用に ID を含める
    });
    
    // 💡 2. ゼロラインと平均ラインのY座標計算
    const ZERO_LINE_Y = CHART_HEIGHT * (1 - (0 - minScore) / scoreRange); 
    const AVG_LINE_Y = CHART_HEIGHT * (1 - (avgScore - minScore) / scoreRange);
    
    // データの最新5つをX軸ラベルとして使用
    const displayLabels = karmaHistory.slice(-5).map(item => {
        const date = new Date(item.timestamp);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    });
    
    // X軸ラベルの描画間隔を計算
    const labelStep = (screenWidth - 40 - PADDING_HORIZONTAL * 2) / (displayLabels.length - 1 || 1);

    return (
      <View style={styles.chartContainer}>
        <Text style={styles.chartTitle}>カルマスコア推移 (直近{karmaHistory.length}件の行動)</Text>

        <View style={styles.chartAreaWrapper}>
            {/* ゼロラインのViewを配置 */}
            {ZERO_LINE_Y >= 0 && ZERO_LINE_Y <= CHART_HEIGHT && (
                <View 
                    key="zero-line" // 🚨 key を追加
                    style={[
                        styles.zeroLine, 
                        { 
                            top: ZERO_LINE_Y, 
                        }
                    ]} 
                />
            )}
            
            {/* 💡 3. 平均ラインのViewを配置 (破線) */}
            <View 
                key="average-line" // 🚨 key を追加
                style={[
                    styles.averageLine, 
                    { 
                        top: AVG_LINE_Y, 
                    }
                ]} 
            >
                <Text style={styles.averageLineLabel}>平均: {avgScore.toFixed(1)}</Text>
            </View>


            {/* Y軸の基準線 (現在のスコア、最小スコア、最大スコアのライン) */}
            <View style={[styles.chartAxis, { height: CHART_HEIGHT }]}>
                {/*
                 * 1. データライン (折れ線グラフ)
                 */}
                {
                    chartPoints.map((p1, index) => {
                        if (index === 0) return null;
                        const p0 = chartPoints[index - 1];
                        
                        // 2点間の距離と角度を計算して、線としてのViewを配置
                        const dx = p1.x - p0.x;
                        const dy = p1.y - p0.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const angle = Math.atan2(dy, dx);

                        return (
                            <View 
                                key={`line-${p1.id}`} // 🚨 key を追加 (p1のIDまたはインデックスを使用)
                                style={[
                                    styles.dataLine,
                                    {
                                        left: p0.x,
                                        top: p0.y,
                                        width: distance,
                                        transform: [
                                            { translateX: 0 },
                                            { translateY: -1.5 }, // 線の太さの半分を上にずらす
                                            { rotate: `${angle}rad` },
                                        ],
                                    }
                                ]}
                            />
                        );
                    })
                }

                {/* 2. データポイント */}
                {chartPoints.map((point, index) => (
                    <View 
                        key={`point-${point.id}`} // 🚨 key を追加 (ポイントのIDまたはインデックスを使用)
                        style={[
                            styles.dataPoint,
                            {
                                left: point.x - 5, // ポイントの中心
                                top: point.y - 5,
                                backgroundColor: point.score >= 0 ? '#4F46E5' : '#EF4444' // スコアに応じて色分け
                            }
                        ]}
                    >
                        {/* ツールチップとしてスコアを表示 */}
                        <Text style={styles.dataPointScore}>{point.score.toFixed(0)}</Text>
                    </View>
                ))}
            </View>
        </View>

        {/* X軸ラベル */}
        <View style={styles.lineChartFooter}>
            {displayLabels.map((label, index) => (
                <Text 
                    key={`label-${index}`} // 🚨 key を追加
                    style={[
                        styles.lineChartLabel,
                        {
                            // 画面幅に応じてラベルを配置
                            width: labelStep,
                            marginLeft: index === 0 ? PADDING_HORIZONTAL : 0,
                        }
                    ]}
                >
                    {label}
                </Text>
            ))}
        </View>
        
        <Text style={styles.chartFooter}>
            平均: {avgScore.toFixed(1)}点。曲線が平均より上にいるか確認しましょう。
        </Text>
      </View>
    );
  };
  
  // --- 履歴アイテムのレンダリング (中略) ---
  const renderHistoryItem = ({ item }: { item: ActionItem }) => {
    const isPAction = item.action_type === 'P';
    const deltaText = (isPAction ? '+' : '-') + (item.weight * 1).toFixed(1);
    const itemColor = isPAction ? '#D1FAE5' : '#FEE2E2';
    const icon = isPAction ? '✅' : '❌';

    return (
      <View style={[styles.historyItem, { backgroundColor: itemColor }]}>
        <View style={styles.historyTextContainer}>
            <Text style={styles.historyDescription} numberOfLines={2}>
                {icon} {item.description}
            </Text>
            <Text style={styles.historyDetails}>
                重み: {item.weight} | 時間: {item.time_minutes}分 | {new Date(item.timestamp).toLocaleDateString()}
            </Text>
        </View>
        <View style={styles.historyScoreContainer}>
            <Text style={[styles.historyScore, { color: isPAction ? '#059669' : '#DC2626' }]}>
                {deltaText}
            </Text>
            <TouchableOpacity 
                style={styles.editButton} 
                onPress={() => openEditModal(item)}
            >
                <Text style={styles.editButtonText}>✏️</Text>
            </TouchableOpacity>
            <TouchableOpacity 
                style={styles.deleteButton} 
                onPress={() => handleDeleteAction(item.id)}
            >
                <Text style={styles.deleteButtonText}>🗑️</Text>
            </TouchableOpacity>
        </View>
      </View>
    );
  };

  // --- メインレンダリング ---
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>カルマ・ディセント・モバイル</Text>
      <Text style={styles.subtitle}>りかさんにふさわしい人間になるための行動記録</Text>
      <Text style={[styles.totalScore, { color: scoreColor }]}>
        現在のカルマスコア: {scoreText}
      </Text>
      <Text style={styles.userIdText}>ユーザーID: {firebaseUser?.uid || '認証中...'}</Text>

      {/* グラフエリア */}
      {renderKarmaChart()}

      {/* 記録フォーム */}
      <View style={styles.formContainer}>
        <Text style={styles.formTitle}>今日の行動を記録</Text>
        <View style={styles.actionTypeSelector}>
          <TouchableOpacity
            key="type-p" // 🚨 key を追加
            style={[styles.typeButton, actionType === 'P' && styles.typeButtonActiveP]}
            onPress={() => setActionType('P')}
          >
            <Text style={styles.typeButtonText}>✅ P行動 (善行)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            key="type-n" // 🚨 key を追加
            style={[styles.typeButton, actionType === 'N' && styles.typeButtonActiveN]}
            onPress={() => setActionType('N')}
          >
            <Text style={styles.typeButtonText}>❌ N行動 (悪行)</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.inputLabel}>行動内容</Text>
        <TextInput
          style={styles.input}
          placeholder="例：論文を30分読んだ / ネットで時間を浪費した"
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <Text style={styles.inputLabel}>重み (1~10)</Text>
        <View style={styles.weightSelector}>
          {/* 🚨 key を追加 */}
          {quickWeights.map(w => (
            <TouchableOpacity
              key={`weight-${w}`}
              style={[styles.quickWeightButton, weight === w && styles.quickWeightButtonActive]}
              onPress={() => setWeight(w)}
            >
              <Text style={styles.quickWeightText}>{w}</Text>
            </TouchableOpacity>
          ))}
          <TextInput
            style={[styles.inputSmall, styles.weightInput, { borderColor: weight > 0 && weight <= 10 ? '#4F46E5' : '#EF4444' }]}
            keyboardType="numeric"
            value={String(weight)}
            onChangeText={(text) => setWeight(parseInt(text) || 1)}
          />
        </View>

        <Text style={styles.inputLabel}>継続時間（分）</Text>
        <TextInput
          style={styles.inputSmall}
          keyboardType="numeric"
          value={String(timeMinutes)}
          onChangeText={(text) => setTimeMinutes(parseInt(text) || 0)}
        />
        
        {actionType === 'N' && (
          <>
            <Text key="emotion-label" style={styles.inputLabel}>N行動時の感情（回復のため）</Text>
            <TextInput
              key="emotion-input"
              style={styles.inputSmall}
              placeholder="例：焦燥感 / 虚無感"
              value={emotion || ''}
              onChangeText={setEmotion}
            />
          </>
        )}

        <TouchableOpacity style={styles.recordButton} onPress={handleRecordAction}>
          <Text style={styles.recordButtonText}>{actionType === 'P' ? 'P行動を記録してカルマ上昇' : 'N行動を記録して教訓を得る'}</Text>
        </TouchableOpacity>
      </View>

      {/* 履歴リスト */}
      <Text style={styles.formTitle}>行動履歴 ({actionHistory.length}件)</Text>
      <View style={styles.historyList}>
        {/* 🚨 key を追加: item.id はサーバーからの一意の識別子なので最適 */}
        {actionHistory.slice().reverse().map((item) => (
            <View key={item.id}>
                {renderHistoryItem({ item })}
            </View>
        ))}
      </View>
      
      {/* 編集モーダル */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isModalVisible}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={modalStyles.centeredView}>
          <View style={modalStyles.modalView}>
            <Text style={modalStyles.modalTitle}>行動の編集</Text>
            {editingAction && (
              <>
                <Text style={modalStyles.modalLabel}>行動タイプ</Text>
                <View style={styles.actionTypeSelector}>
                  <TouchableOpacity
                    key="edit-type-p"
                    style={[styles.typeButton, editActionType === 'P' && styles.typeButtonActiveP]}
                    onPress={() => setEditActionType('P')}
                  >
                    <Text style={styles.typeButtonText}>✅ P行動</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    key="edit-type-n"
                    style={[styles.typeButton, editActionType === 'N' && styles.typeButtonActiveN]}
                    onPress={() => setEditActionType('N')}
                  >
                    <Text style={styles.typeButtonText}>❌ N行動</Text>
                  </TouchableOpacity>
                </View>
                
                <Text style={modalStyles.modalLabel}>内容</Text>
                <TextInput
                  style={modalStyles.modalInput}
                  value={editDescription}
                  onChangeText={setEditDescription}
                  multiline
                />
                
                <Text style={modalStyles.modalLabel}>重み (1~10)</Text>
                <TextInput
                  style={modalStyles.modalInputSmall}
                  keyboardType="numeric"
                  value={String(editWeight)}
                  onChangeText={(text) => setEditWeight(parseInt(text) || 1)}
                />

                <Text style={modalStyles.modalLabel}>時間（分）</Text>
                <TextInput
                  style={modalStyles.modalInputSmall}
                  keyboardType="numeric"
                  value={String(editTimeMinutes)}
                  onChangeText={(text) => setEditTimeMinutes(parseInt(text) || 0)}
                />

                {editActionType === 'N' && (
                  <>
                    <Text key="edit-emotion-label" style={modalStyles.modalLabel}>感情</Text>
                    <TextInput
                      key="edit-emotion-input"
                      style={modalStyles.modalInputSmall}
                      value={editEmotion || ''}
                      onChangeText={setEditEmotion}
                    />
                  </>
                )}

                <TouchableOpacity style={modalStyles.saveButton} onPress={handleUpdateAction}>
                  <Text style={modalStyles.saveButtonText}>変更を保存 (スコア再計算)</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={modalStyles.closeButton} onPress={() => setIsModalVisible(false)}>
              <Text style={modalStyles.closeButtonText}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}


// =================================================================
// スタイルシート (変更なし)
// =================================================================
const modalStyles = StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 35,
    alignItems: 'stretch',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#1F2937',
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 14,
    color: '#4B5563',
    marginTop: 10,
    marginBottom: 5,
    fontWeight: '600',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    marginBottom: 10,
  },
  modalInputSmall: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    width: '100%',
    marginBottom: 10,
  },
  saveButton: {
    backgroundColor: '#10B981',
    borderRadius: 10,
    padding: 12,
    elevation: 2,
    marginTop: 20,
  },
  saveButtonText: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 16,
  },
  closeButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 12,
    elevation: 2,
    marginTop: 10,
  },
  closeButtonText: {
    color: '#4B5563',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 16,
  }
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingTop: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#4F46E5',
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 15,
  },
  userIdText: {
    fontSize: 10,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 15,
  },
  totalScore: {
    fontSize: 40,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
  },
  formContainer: {
    backgroundColor: 'white',
    padding: 20,
    marginHorizontal: 15,
    borderRadius: 15,
    marginBottom: 25,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 15,
    borderBottomWidth: 2,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 8,
  },
  inputLabel: {
    fontSize: 14,
    color: '#4B5563',
    marginTop: 15,
    marginBottom: 5,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputSmall: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    height: 45,
  },
  actionTypeSelector: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  typeButton: {
    flex: 1,
    padding: 10,
    marginHorizontal: 5,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
  },
  typeButtonActiveP: {
    backgroundColor: '#34D399', // Green for P
  },
  typeButtonActiveN: {
    backgroundColor: '#F87171', // Red for N
  },
  typeButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  weightSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  quickWeightButton: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    marginRight: 8,
    minWidth: 40,
    alignItems: 'center',
  },
  quickWeightButtonActive: {
    backgroundColor: '#4F46E5',
    transform: [{ scale: 1.1 }],
  },
  quickWeightText: {
    color: '#1F2937',
    fontWeight: 'bold',
  },
  weightInput: {
    flex: 1,
    marginLeft: 10,
  },
  recordButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    padding: 15,
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  recordButtonText: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 18,
  },
  historyList: {
    paddingHorizontal: 15,
    marginBottom: 50,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  historyTextContainer: {
    flex: 1,
    marginRight: 10,
  },
  historyDescription: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  historyDetails: {
    fontSize: 12,
    color: '#6B7280',
  },
  historyScoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyScore: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  editButton: {
    marginLeft: 10,
    padding: 5,
  },
  editButtonText: {
    fontSize: 16,
  },
  deleteButton: {
    marginLeft: 10,
    padding: 5,
  },
  deleteButtonText: {
    fontSize: 16,
  },
  // --- グラフスタイル (Line Chart REAL) ---
  chartContainer: {
    backgroundColor: '#F3F4F6',
    borderRadius: 15,
    paddingVertical: 15,
    marginBottom: 25,
    marginHorizontal: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 10,
  },
  chartAreaWrapper: {
    marginHorizontal: 20,
    backgroundColor: '#ffffff',
    height: CHART_HEIGHT,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  chartAxis: {
    position: 'relative',
    height: '100%',
    width: '100%',
  },
  // ゼロラインのスタイル
  zeroLine: {
    position: 'absolute',
    backgroundColor: '#9CA3AF', // グレー
    left: 0,
    right: 0,
    height: 1, // 線の太さ
    zIndex: 5, // 他の線より上
  },
  // 💡 平均ラインのスタイル (破線)
  averageLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2, 
    borderStyle: 'dashed', // 破線にする
    borderColor: '#F59E0B', // オレンジ
    borderWidth: 1,
    zIndex: 6, 
    justifyContent: 'center',
  },
  averageLineLabel: {
    position: 'absolute',
    right: 5,
    top: -15, 
    fontSize: 10,
    fontWeight: 'bold',
    color: '#F59E0B',
    backgroundColor: 'white',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  dataLine: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#4F46E5', // 線の色 (青)
    transformOrigin: 'top left',
  },
  dataPoint: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#fff',
    // スコアの表示（ツールチップ的なもの）
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  dataPointScore: {
    fontSize: 10,
    color: '#1F2937',
    position: 'absolute',
    top: -15, // ポイントの上に表示
    fontWeight: 'bold',
  },
  chartFooter: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 15,
  },
  noChartData: {
    height: CHART_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noHistoryText: {
    color: '#9CA3AF',
    fontSize: 16,
  },
  lineChartFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-start', // X軸ラベルは左寄せ
    paddingHorizontal: 20,
    marginTop: 8,
  },
  lineChartLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
    textAlign: 'center',
  }
});
