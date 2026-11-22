import { PROFILES, type Pair, type Script, type Segment } from '../../packages/protocol/index.ts';

// Authored fictional display fixtures only: never submitted to ASR, translation or canonical state. One conversation per
// pair language, each the same eight turns; a pair without its own falls back to English and Japanese.
type Example = readonly ['en' | 'other', string, string];

const JAPANESE: readonly Example[] = [
  ['en', 'Before we begin, could you explain how this companion handles a longer conversation? I would like to read the English translation while still being able to look back at the original Japanese, especially when a speaker introduces an unfamiliar technical term.',
    '始める前に、このアプリが長い会話をどのように扱うか説明していただけますか。特に話し手が聞き慣れない専門用語を使ったとき、英訳を読みながら日本語の原文も振り返りたいです。'],
  ['other', 'はい。ここでは一つの発言ごとに原文と翻訳を並べています。短い返事だけでなく、いくつかの文が続く説明もあります。文字を小さくすると前後の流れを一度に見渡しやすくなりますが、離れた場所から読む場合は大きい文字のほうが便利です。',
    'Yes. Each turn keeps its original and translation together. Some turns are short replies; others contain several sentences. Smaller text makes it easier to see the surrounding discussion at once, while larger text is more useful when reading from a distance.'],
  ['en', 'That makes sense. Let us try a practical example: imagine a lecture about keeping a personal knowledge base. The speaker describes collecting notes, connecting related ideas, and reviewing old decisions. A useful translation should preserve those distinctions instead of turning every idea into a generic summary.',
    'なるほど。実際の例を試しましょう。個人用の知識ベースについての講演を想像してください。話し手は、メモを集め、関連する考えを結び付け、過去の判断を振り返ることを説明しています。役に立つ翻訳では、すべてを一般的な要約にするのではなく、それぞれの違いを保つ必要があります。'],
  ['other', '講演の途中で、前の説明に戻りたいこともありますね。たとえば「その判断」という言葉が何を指すか確認するために、少し前の発言を探します。新しい文章が届いても、読んでいる場所が勝手に一番下へ移動しないことが大切です。',
    'During a lecture, you may want to return to an earlier explanation. For example, you might look back a few turns to check what “that decision” refers to. It matters that new text does not pull you to the bottom while you are reading an earlier passage.'],
  ['other', 'もう一つ質問があります。英語の質問に日本語で答えたあと、同じ人が続けて日本語で補足した場合はどうなりますか。会話は必ずしも二つの言語が交互に現れるとは限りません。',
    'I have another question. What happens if someone answers an English question in Japanese and then adds another explanation in Japanese? Conversations do not necessarily alternate between the two languages.'],
  ['en', 'Exactly. This preview includes consecutive Japanese turns as well as English questions. Try searching for “lecture” or “日本語”, switching to compact spacing, and comparing a narrow reading column with the full window. These are fictional examples for checking the layout, not measured translation results.',
    'そのとおりです。このプレビューには、英語の質問だけでなく、日本語が続く発言も含まれています。「lecture」や「日本語」を検索し、間隔をコンパクトにして、狭い表示幅とウィンドウ全体の幅を比べてみてください。これはレイアウト確認用の架空の例で、翻訳性能を測定した結果ではありません。'],
  ['other', '読みやすさは文字の大きさだけでは決まりません。行間、段落の余白、一行の長さも影響します。長い説明を読むときは少し狭い幅が合う人もいますし、会話の全体像を見たいときは広い幅が合う人もいます。\n\nこの段落のように改行が含まれる場合も、全文を省略せずに確認できると便利です。',
    'Readability depends on more than font size. Line spacing, padding, and line length also matter. Some people prefer a narrower column for long explanations; others prefer a wider view to see more of the conversation.\n\nWhen a turn contains paragraph breaks like this one, it is useful to be able to read the whole passage without truncation.'],
  ['en', 'Thank you. I will try the smaller sizes first, then increase the translation size until it feels comfortable. After that I can leave the preview, return to the real recent history, and start the microphone when I am ready. None of this sample conversation should become translation context.',
    'ありがとうございます。まず小さい文字を試してから、読みやすくなるまで翻訳の文字を大きくしてみます。その後プレビューを終了して実際の直近の履歴に戻り、準備ができたらマイクを開始できます。このサンプル会話が翻訳の文脈に入ることはありません。'],
];

// The English side of the other conversations: Japanese's, with the language's name and a search word in it.
function withEnglish(name: string, word: string, other: readonly string[]): Example[] {
  const english = [
    `Before we begin, could you explain how this companion handles a longer conversation? I would like to read the English translation while still being able to look back at the original ${name}, especially when a speaker introduces an unfamiliar technical term.`,
    JAPANESE[1]![2],
    JAPANESE[2]![1],
    JAPANESE[3]![2],
    `I have another question. What happens if someone answers an English question in ${name} and then adds another explanation in ${name}? Conversations do not necessarily alternate between the two languages.`,
    `Exactly. This preview includes consecutive ${name} turns as well as English questions. Try searching for “lecture” or “${word}”, switching to compact spacing, and comparing a narrow reading column with the full window. These are fictional examples for checking the layout, not measured translation results.`,
    JAPANESE[6]![2],
    JAPANESE[7]![1],
  ];
  return JAPANESE.map(([source], i) => source === 'en' ? ['en', english[i]!, other[i]!] : ['other', other[i]!, english[i]!]);
}

const EXAMPLES: Record<string, readonly Example[]> = {
  ja: JAPANESE,
  es: withEnglish('Spanish', 'español', [
    'Antes de empezar, ¿podría explicar cómo maneja esta aplicación una conversación más larga? Me gustaría leer la traducción al inglés sin dejar de consultar el original en español, sobre todo cuando un ponente introduce un término técnico desconocido.',
    'Sí. Aquí cada intervención mantiene juntos el original y la traducción. Algunas son respuestas breves; otras contienen varias frases. Con un texto más pequeño es más fácil ver de un vistazo el hilo de la conversación, mientras que un texto más grande resulta más útil cuando se lee a distancia.',
    'Tiene sentido. Probemos con un ejemplo práctico: imagine una conferencia sobre cómo mantener una base de conocimiento personal. El ponente describe cómo reunir notas, relacionar ideas afines y revisar decisiones antiguas. Una buena traducción debe conservar esas distinciones en lugar de convertir cada idea en un resumen genérico.',
    'Durante una conferencia, a veces uno quiere volver a una explicación anterior. Por ejemplo, para comprobar a qué se refiere «esa decisión», busca una intervención un poco anterior. Es importante que el texto nuevo no lo arrastre hasta el final mientras está leyendo un pasaje anterior.',
    'Tengo otra pregunta. ¿Qué pasa si alguien responde en español a una pregunta en inglés y luego añade otra explicación en español? Las conversaciones no siempre alternan entre los dos idiomas.',
    'Exacto. Esta vista previa incluye intervenciones seguidas en español además de preguntas en inglés. Pruebe a buscar «lecture» o «español», a cambiar a un espaciado compacto y a comparar una columna de lectura estrecha con la ventana completa. Son ejemplos ficticios para comprobar el diseño, no resultados medidos de traducción.',
    'La legibilidad no depende solo del tamaño de la letra. El interlineado, los márgenes y la longitud de las líneas también influyen. Hay quien prefiere una columna más estrecha para las explicaciones largas y quien prefiere una vista más amplia para ver más de la conversación.\n\nCuando una intervención contiene saltos de párrafo como esta, conviene poder leer el pasaje completo sin que se recorte.',
    'Gracias. Probaré primero los tamaños más pequeños y luego aumentaré el tamaño de la traducción hasta que me resulte cómodo. Después podré salir de la vista previa, volver al historial reciente real y activar el micrófono cuando esté listo. Nada de esta conversación de ejemplo debe pasar al contexto de la traducción.',
  ]),
  fr: withEnglish('French', 'français', [
    'Avant de commencer, pourriez-vous expliquer comment cette application gère une conversation plus longue ? J’aimerais lire la traduction anglaise tout en pouvant revenir à l’original en français, surtout quand un intervenant introduit un terme technique inconnu.',
    'Oui. Ici, chaque intervention garde ensemble l’original et sa traduction. Certaines sont de brèves réponses ; d’autres contiennent plusieurs phrases. Un texte plus petit permet de voir d’un coup d’œil le fil de la discussion, tandis qu’un texte plus grand est plus pratique pour lire de loin.',
    'C’est logique. Prenons un exemple concret : imaginez une conférence sur la tenue d’une base de connaissances personnelle. L’intervenant décrit comment rassembler des notes, relier des idées voisines et revenir sur d’anciennes décisions. Une bonne traduction doit préserver ces nuances au lieu de réduire chaque idée à un résumé générique.',
    'Pendant une conférence, on veut parfois revenir à une explication antérieure. Par exemple, pour vérifier à quoi renvoie « cette décision », on remonte de quelques interventions. Il est important que le nouveau texte ne vous ramène pas en bas pendant que vous lisez un passage plus ancien.',
    'J’ai une autre question. Que se passe-t-il si quelqu’un répond en français à une question posée en anglais, puis ajoute une autre explication en français ? Les conversations n’alternent pas forcément entre les deux langues.',
    'Exactement. Cet aperçu comprend des interventions successives en français ainsi que des questions en anglais. Essayez de rechercher « lecture » ou « français », de passer à un espacement compact et de comparer une colonne de lecture étroite avec la fenêtre entière. Ce sont des exemples fictifs pour vérifier la mise en page, pas des résultats de traduction mesurés.',
    'La lisibilité ne dépend pas seulement de la taille des caractères. L’interligne, les marges et la longueur des lignes comptent aussi. Certains préfèrent une colonne plus étroite pour les longues explications ; d’autres, une vue plus large pour voir davantage de la conversation.\n\nQuand une intervention contient des sauts de paragraphe comme celle-ci, il est utile de pouvoir lire tout le passage sans qu’il soit tronqué.',
    'Merci. Je vais d’abord essayer les petites tailles, puis agrandir la traduction jusqu’à ce qu’elle soit confortable. Ensuite, je pourrai quitter l’aperçu, revenir au véritable historique récent et lancer le micro quand je serai prêt. Rien de cette conversation d’exemple ne doit entrer dans le contexte de traduction.',
  ]),
  it: withEnglish('Italian', 'italiano', [
    'Prima di iniziare, potrebbe spiegare come questa applicazione gestisce una conversazione più lunga? Vorrei leggere la traduzione inglese pur potendo tornare all’originale in italiano, soprattutto quando un relatore introduce un termine tecnico poco familiare.',
    'Sì. Qui ogni intervento tiene insieme l’originale e la traduzione. Alcuni sono risposte brevi; altri contengono diverse frasi. Un testo più piccolo permette di vedere a colpo d’occhio il filo della discussione, mentre un testo più grande è più utile quando si legge da lontano.',
    'Ha senso. Proviamo con un esempio pratico: immagini una conferenza su come tenere una base di conoscenza personale. Il relatore descrive come raccogliere appunti, collegare idee affini e rivedere vecchie decisioni. Una traduzione utile deve preservare queste distinzioni invece di trasformare ogni idea in un riassunto generico.',
    'Durante una conferenza, a volte si vuole tornare a una spiegazione precedente. Per esempio, per controllare a cosa si riferisce «quella decisione», si cerca un intervento di poco prima. È importante che il nuovo testo non trascini in fondo mentre si sta leggendo un passaggio precedente.',
    'Ho un’altra domanda. Che cosa succede se qualcuno risponde in italiano a una domanda in inglese e poi aggiunge un’altra spiegazione in italiano? Le conversazioni non alternano necessariamente le due lingue.',
    'Esatto. Questa anteprima include interventi consecutivi in italiano oltre a domande in inglese. Provi a cercare «lecture» o «italiano», a passare a una spaziatura compatta e a confrontare una colonna di lettura stretta con l’intera finestra. Sono esempi fittizi per verificare l’impaginazione, non risultati di traduzione misurati.',
    'La leggibilità non dipende solo dalla dimensione del carattere. Contano anche l’interlinea, i margini e la lunghezza delle righe. Alcuni preferiscono una colonna più stretta per le spiegazioni lunghe; altri una vista più ampia per vedere una parte maggiore della conversazione.\n\nQuando un intervento contiene interruzioni di paragrafo come questo, è utile poter leggere l’intero passaggio senza tagli.',
    'Grazie. Proverò prima le dimensioni più piccole, poi aumenterò la dimensione della traduzione finché non sarà comoda. Dopo potrò uscire dall’anteprima, tornare alla vera cronologia recente e avviare il microfono quando sarò pronto. Nulla di questa conversazione di esempio deve entrare nel contesto della traduzione.',
  ]),
  pt: withEnglish('Portuguese', 'português', [
    'Antes de começarmos, você poderia explicar como este aplicativo lida com uma conversa mais longa? Eu gostaria de ler a tradução em inglês e ainda poder consultar o original em português, principalmente quando um palestrante apresenta um termo técnico desconhecido.',
    'Sim. Aqui cada fala mantém o original e a tradução juntos. Algumas são respostas curtas; outras têm várias frases. Um texto menor facilita ver de uma vez o andamento da conversa, enquanto um texto maior é mais útil para ler à distância.',
    'Faz sentido. Vamos tentar um exemplo prático: imagine uma palestra sobre como manter uma base de conhecimento pessoal. O palestrante descreve como reunir anotações, conectar ideias relacionadas e rever decisões antigas. Uma boa tradução deve preservar essas distinções em vez de transformar cada ideia em um resumo genérico.',
    'Durante uma palestra, às vezes queremos voltar a uma explicação anterior. Por exemplo, para conferir a que se refere “essa decisão”, procuramos uma fala um pouco anterior. É importante que o texto novo não nos leve para o final enquanto estamos lendo um trecho anterior.',
    'Tenho outra pergunta. O que acontece se alguém responde em português a uma pergunta em inglês e depois acrescenta outra explicação em português? As conversas nem sempre alternam entre os dois idiomas.',
    'Exatamente. Esta prévia inclui falas seguidas em português, além de perguntas em inglês. Experimente buscar “lecture” ou “português”, mudar para o espaçamento compacto e comparar uma coluna de leitura estreita com a janela inteira. São exemplos fictícios para verificar o layout, não resultados de tradução medidos.',
    'A legibilidade não depende só do tamanho da letra. O espaçamento entre linhas, as margens e o comprimento das linhas também influenciam. Algumas pessoas preferem uma coluna mais estreita para explicações longas; outras preferem uma visão mais ampla para ver mais da conversa.\n\nQuando uma fala tem quebras de parágrafo como esta, é útil poder ler o trecho inteiro sem cortes.',
    'Obrigado. Vou testar primeiro os tamanhos menores e depois aumentar a tradução até ficar confortável. Depois posso sair da prévia, voltar ao histórico recente real e ligar o microfone quando estiver pronto. Nada desta conversa de exemplo deve entrar no contexto da tradução.',
  ]),
  zh: withEnglish('Chinese', '中文', [
    '开始之前，能否请您说明一下这个应用如何处理较长的对话？我希望一边阅读英文译文，一边还能回看中文原文，尤其是在讲者提到不熟悉的专业术语时。',
    '可以。这里每一段发言都把原文和译文放在一起。有些是简短的回答，有些则包含好几句话。字小一些，更容易一眼看清前后的讨论；从远处阅读时，大一些的字更方便。',
    '有道理。我们来试一个实际的例子：设想一场关于如何维护个人知识库的讲座。讲者介绍如何收集笔记、把相关的想法联系起来，以及回顾过去的决定。有用的翻译应当保留这些区别，而不是把每个想法都变成笼统的概括。',
    '讲座进行中，有时会想回到前面的说明。比如，为了确认“那个决定”指的是什么，会往前找几段发言。重要的是，新的文字到来时，不会把正在阅读的位置自动拉到最底部。',
    '我还有一个问题。如果有人用中文回答了一个英文问题，接着又用中文补充说明，会怎么样？对话不一定是两种语言轮流出现的。',
    '没错。这个预览里既有英文提问，也有连续的中文发言。可以试着搜索“lecture”或“中文”，切换到紧凑间距，再比较窄的阅读栏和整个窗口的宽度。这些是用于检查版面的虚构示例，不是实测的翻译结果。',
    '可读性不只取决于字的大小。行距、段落的留白和每行的长度也有影响。阅读长篇说明时，有人喜欢窄一些的栏；想看清整段对话时，有人喜欢宽一些的视图。\n\n像这一段一样包含换行时，能够完整阅读而不被截断会很方便。',
    '谢谢。我会先试试较小的字号，然后把译文的字放大到看着舒服为止。之后我可以退出预览，回到真实的近期记录，准备好后再打开麦克风。这段示例对话不会进入翻译的上下文。',
  ]),
  // The same conversation in Traditional characters, as the service converts it; a test keeps the two in step.
  'zh-Hant': withEnglish('Chinese', '中文', [
    '開始之前，能否請您說明一下這個應用如何處理較長的對話？我希望一邊閱讀英文譯文，一邊還能回看中文原文，尤其是在講者提到不熟悉的專業術語時。',
    '可以。這裡每一段發言都把原文和譯文放在一起。有些是簡短的回答，有些則包含好幾句話。字小一些，更容易一眼看清前後的討論；從遠處閱讀時，大一些的字更方便。',
    '有道理。我們來試一個實際的例子：設想一場關於如何維護個人知識庫的講座。講者介紹如何收集筆記、把相關的想法聯繫起來，以及回顧過去的決定。有用的翻譯應當保留這些區別，而不是把每個想法都變成籠統的概括。',
    '講座進行中，有時會想回到前面的說明。比如，為了確認“那個決定”指的是什麼，會往前找幾段發言。重要的是，新的文字到來時，不會把正在閱讀的位置自動拉到最底部。',
    '我還有一個問題。如果有人用中文回答了一個英文問題，接著又用中文補充說明，會怎麼樣？對話不一定是兩種語言輪流出現的。',
    '沒錯。這個預覽裡既有英文提問，也有連續的中文發言。可以試著搜索“lecture”或“中文”，切換到緊湊間距，再比較窄的閱讀欄和整個窗口的寬度。這些是用於檢查版面的虛構示例，不是實測的翻譯結果。',
    '可讀性不只取決於字的大小。行距、段落的留白和每行的長度也有影響。閱讀長篇說明時，有人喜歡窄一些的欄；想看清整段對話時，有人喜歡寬一些的視圖。\n\n像這一段一樣包含換行時，能夠完整閱讀而不被截斷會很方便。',
    '謝謝。我會先試試較小的字號，然後把譯文的字放大到看著舒服為止。之後我可以退出預覽，回到真實的近期記錄，準備好後再打開麥克風。這段示例對話不會進入翻譯的上下文。',
  ]),
};

// The language the preview pairs with English: the session's other language when it has a conversation, else Japanese.
export function previewLanguage(pair: Pair): string {
  const other = pair.find(language => language !== 'en');
  return other && EXAMPLES[other] && PROFILES[other] ? other : 'ja';
}

// In the session's script when the conversation has one for it.
export function previewSegments(pair: Pair, script: Script | null = null): Segment[] {
  const other = previewLanguage(pair);
  return (EXAMPLES[`${other}-${script}`] ?? EXAMPLES[other])!.map(([side, original, translation], sequence) => ({
    id: `layout-preview-${sequence}`, sequence, original, translation, source: side === 'en' ? 'en' : other, target: side === 'en' ? other : 'en',
    final: true, state: 'ready', finalizedAt: null, translationMs: null,
  }));
}
