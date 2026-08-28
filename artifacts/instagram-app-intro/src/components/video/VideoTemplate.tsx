import { useVideoPlayer } from '@/lib/video';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Smartphone,
  Sparkles,
  Waves,
} from 'lucide-react';

const SCENE_DURATIONS = {
  hook: 3600,
  report: 4200,
  code: 3200,
  search: 4400,
  complete: 3600,
  cta: 4000,
};

const transition = {
  initial: { opacity: 0, y: 54, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -42, scale: 1.03 },
  transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
};

function Shell({ step, children }: { step: string; children: React.ReactNode }) {
  return (
    <motion.section {...transition} className="scene">
      <div className="brand"><Waves size={26} strokeWidth={2.6} /><span>HAMASUI</span></div>
      <div className="step">{step}</div>
      {children}
      <div className="progress"><motion.i initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 3.2, ease: 'linear' }} /></div>
    </motion.section>
  );
}

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <motion.div className="phone" initial={{ y: 80, rotate: 2 }} animate={{ y: 0, rotate: 0 }} transition={{ delay: .15, type: 'spring', stiffness: 120, damping: 18 }}>
      <div className="phone-top"><span /><b>9:41</b><em>● ●●</em></div>
      <div className="phone-screen">{children}</div>
    </motion.div>
  );
}

function Hook() {
  return (
    <motion.section {...transition} className="scene hook">
      <motion.div className="orb orb-one" animate={{ y: [0, -24, 0], scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 4 }} />
      <motion.div className="orb orb-two" animate={{ y: [0, 18, 0] }} transition={{ repeat: Infinity, duration: 3.4 }} />
      <div className="brand inverse"><Waves size={30} /><span>HAMASUI</span></div>
      <motion.div className="mini-icon" initial={{ scale: 0, rotate: -15 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: .25, type: 'spring' }}><Smartphone size={43} /></motion.div>
      <motion.h1 initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .35 }}>
        欠席・遅刻連絡から<br/><strong>振替予約まで</strong>
      </motion.h1>
      <motion.div className="pill-white" initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .9 }}>
        スマホで完結
      </motion.div>
      <p>忙しい保護者の手続きを、もっとシンプルに。</p>
      <div className="swipe"><ChevronRight size={20}/> 20秒でご紹介</div>
    </motion.section>
  );
}

function Report() {
  return (
    <Shell step="01  欠席・遅刻を連絡">
      <div className="headline"><small>かんたん入力</small><h2>必要な項目を<br/><strong>選ぶだけ</strong></h2></div>
      <Phone>
        <div className="app-title">欠席・遅刻連絡</div>
        <label>お子さまのお名前</label><div className="input">みずき</div>
        <label>連絡内容</label>
        <div className="segmented"><b>欠席</b><span>遅刻</span></div>
        <label>クラス</label><div className="input row">初級クラス <ChevronRight size={16}/></div>
        <motion.button initial={{ scale: .92 }} animate={{ scale: [1, .97, 1] }} transition={{ delay: 1.1, duration: .35 }}>この内容で登録</motion.button>
      </Phone>
      <div className="caption">電話いらずで、いつでも連絡</div>
    </Shell>
  );
}

function Code() {
  return (
    <Shell step="02  確認コードを保存">
      <div className="headline centered"><small>登録完了</small><h2>確認コードで<br/><strong>あとから確認</strong></h2></div>
      <motion.div className="success-card" initial={{ scale: .78, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 150 }}>
        <CheckCircle2 className="success-icon" size={66}/>
        <h3>欠席連絡を受け付けました</h3>
        <p>あなたの確認コード</p>
        <div className="code">● ● ●　● ● ●</div>
        <span>デモ表示｜個人情報は使用していません</span>
      </motion.div>
      <div className="caption">確認も振替も、このコードから</div>
    </Shell>
  );
}

function Search() {
  const slots = [
    ['8/18 火', '16:30', '初級', '残り 2枠'],
    ['8/20 木', '17:30', '初級', '残り 1枠'],
  ];
  return (
    <Shell step="03  振替枠を検索">
      <div className="headline"><small>空き状況がひと目で</small><h2>通える日時を<br/><strong>すぐ選べる</strong></h2></div>
      <Phone>
        <div className="app-title row"><span>振替枠を選択</span><CalendarDays size={20}/></div>
        <div className="month">2026年 8月</div>
        <div className="week"><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span></div>
        <div className="dates"><i>17</i><i className="active">18</i><i>19</i><i>20</i><i>21</i></div>
        <div className="slot-list">
          {slots.map((slot, index) => (
            <motion.div className="slot" key={slot[0]} initial={{ x: 35, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: .45 + index * .25 }}>
              <div><b>{slot[0]}</b><strong>{slot[1]}</strong></div><span>{slot[2]}</span><em>{slot[3]}</em><ChevronRight size={18}/>
            </motion.div>
          ))}
        </div>
      </Phone>
      <div className="caption">カレンダーから空き枠をチェック</div>
    </Shell>
  );
}

function Complete() {
  return (
    <Shell step="04  予約完了">
      <div className="headline centered"><small>これで完了</small><h2>振替予約も<br/><strong>スムーズに</strong></h2></div>
      <motion.div className="ticket" initial={{ rotateX: 70, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ duration: .65 }}>
        <div className="ticket-head"><Check size={27}/><b>振替予約が確定しました</b></div>
        <div className="ticket-row"><CalendarDays/><span>2026年8月18日（火）</span></div>
        <div className="ticket-row"><Clock3/><span>16:30　初級クラス</span></div>
        <div className="ticket-dots" />
        <p>ご予約内容は確認コードから<br/>いつでも確認できます</p>
      </motion.div>
      <div className="caption">迷わず、待たずに、手続き完了</div>
    </Shell>
  );
}

function Cta() {
  return (
    <motion.section {...transition} className="scene cta">
      <motion.div className="wave-mark" animate={{ rotate: [0, 4, -4, 0] }} transition={{ repeat: Infinity, duration: 3 }}><Waves size={56}/></motion.div>
      <Sparkles className="spark s1"/><Sparkles className="spark s2"/>
      <p className="eyebrow">SWIM SCHOOL SUPPORT</p>
      <h2>もっと気軽に。<br/><strong>もっと通いやすく。</strong></h2>
      <p className="cta-copy">欠席・遅刻連絡から振替予約まで<br/>スマホひとつで。</p>
      <motion.div className="cta-button" animate={{ scale: [1, 1.035, 1] }} transition={{ repeat: Infinity, duration: 1.7 }}>
        保護者ページを開く <ChevronRight size={24}/>
      </motion.div>
      <div className="brand footer-brand"><Waves size={25}/><span>HAMASUI</span></div>
    </motion.section>
  );
}

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });
  const scenes = [<Hook/>, <Report/>, <Code/>, <Search/>, <Complete/>, <Cta/>];
  return (
    <main className="video-frame">
      <AnimatePresence mode="wait">{<div key={currentScene}>{scenes[currentScene]}</div>}</AnimatePresence>
    </main>
  );
}