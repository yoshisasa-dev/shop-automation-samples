"""見本用ストアに、パティスリー こむぎ（サンプル店）の商品・コレクション・ページ・メニューを作る

Shopify CLI の `store execute`（Admin GraphQL）を使う。
同じハンドルのものがすでにあれば作り直さないので、何度実行しても同じものは増えない。

使い方（対象のストアは環境変数 SHOPIFY_STORE で指定する）:
    export SHOPIFY_STORE=your-store.myshopify.com
    python3 setup_store.py products   商品7点を作る（ケーキはサイズ 4号・5号・6号で値段が変わる）
    python3 setup_store.py archive    最初から入っているテスト商品をアーカイブする（消さない）
    python3 setup_store.py site       コレクション・ページ・メニュー・店頭受け取りを作る
    python3 setup_store.py hero       トップページの看板画像を「ファイル」に上げる
    python3 setup_store.py all        products → archive → site を順に実行（hero は入らない）

hero だけは、実行するたびに画像が1枚ずつ増えるので、all に入れず1回だけ別に実行する。
引数がない・知らない引数のときは、この使い方を出して終わる。
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGE_DIR = os.path.join(HERE, 'images', 'out')


# ---------------------------------------------------------------------------
# 作る中身
# ---------------------------------------------------------------------------

STORE_NAME = 'パティスリー こむぎ（サンプル店）'

ALLERGY = '<p><strong>アレルギー：</strong>卵・乳・小麦{extra}</p>'
SIZE_NOTE = ('<ul><li>4号（直径12cm）…2〜4名さま</li><li>5号（直径15cm）…4〜6名さま</li>'
             '<li>6号（直径18cm）…6〜8名さま</li></ul>')
CAKE_NOTE = ('<p>受け取り日の3日前までにご予約ください。お受け取りは店頭のみです（定休日：火曜日）。</p>'
             '<p>メッセージプレート・ろうそくは無料でおつけします。</p>')

SIZES = ['4号', '5号', '6号']

# ケーキは prices（4号・5号・6号の値段）、焼き菓子は price（1つの値段）を持つ
PRODUCTS = [
    {'handle': 'strawberry-shortcake', 'title': 'いちごのショートケーキ', 'type': 'ケーキ', 'image': 'shortcake',
     'prices': [3240, 4320, 5400], 'tags': ['誕生日', '人気No.1'],
     'desc': '<p>ふんわりスポンジに、甘さひかえめの生クリームと国産いちごをたっぷり。お誕生日にいちばん選ばれているケーキです。</p>'
             + SIZE_NOTE + CAKE_NOTE + ALLERGY.format(extra='')},
    {'handle': 'gateau-chocolat', 'title': '濃厚ガトーショコラ', 'type': 'ケーキ', 'image': 'gateau-chocolat',
     'prices': [3024, 4104, 5184], 'tags': ['誕生日', 'チョコレート'],
     'desc': '<p>カカオ分の高いチョコレートを使った、しっとり濃厚なガトーショコラ。粉糖とミントで仕上げています。</p>'
             + SIZE_NOTE + CAKE_NOTE + ALLERGY.format(extra='')},
    {'handle': 'fruit-tart', 'title': '季節のフルーツタルト', 'type': 'ケーキ', 'image': 'fruit-tart',
     'prices': [3780, 4860, 5940], 'tags': ['誕生日', '季節限定'],
     'desc': '<p>サクサクのタルトに、カスタードと旬のフルーツを色とりどりにのせました。フルーツは季節によって変わります。</p>'
             + SIZE_NOTE + CAKE_NOTE + ALLERGY.format(extra='・アーモンド')},
    {'handle': 'baked-cheesecake', 'title': 'ベイクドチーズケーキ', 'type': 'ケーキ', 'image': 'cheesecake',
     'prices': [2916, 3888, 4860], 'tags': ['誕生日'],
     'desc': '<p>クリームチーズをたっぷり使った、なめらかで濃厚なベイクドチーズケーキ。ブルーベリーを添えています。</p>'
             + SIZE_NOTE + CAKE_NOTE + ALLERGY.format(extra='')},
    {'handle': 'gift-box-10', 'title': '焼き菓子ギフト（10個入り）', 'type': '焼き菓子', 'image': 'gift-box',
     'price': 2160, 'tags': ['ギフト'],
     'desc': '<p>フィナンシェ・マドレーヌ・クッキーなど、人気の焼き菓子を10個詰め合わせました。リボンをかけてお渡しします。</p>'
             '<p>賞味期限：お受け取りから7日</p>' + ALLERGY.format(extra='・アーモンド')},
    {'handle': 'financier-5', 'title': 'フィナンシェ（5個入り）', 'type': '焼き菓子', 'image': 'financier',
     'price': 1080, 'tags': ['ギフト'],
     'desc': '<p>焦がしバターの香りがひろがる、外はカリッと中はしっとりのフィナンシェです。</p>'
             '<p>賞味期限：お受け取りから7日</p>' + ALLERGY.format(extra='・アーモンド')},
    {'handle': 'cookie-tin', 'title': 'クッキー缶', 'type': '焼き菓子', 'image': 'cookie-tin',
     'price': 1944, 'tags': ['ギフト'],
     'desc': '<p>5種類のクッキーを、水色のかわいい缶に詰めました。ちょっとした贈り物にどうぞ。</p>'
             '<p>賞味期限：お受け取りから14日</p>' + ALLERGY.format(extra='')},
]

GUIDE_HTML = '''
<h2>ご予約の流れ</h2>
<ol>
<li>ケーキを選び、サイズ（4号・5号・6号）を選びます</li>
<li>メッセージプレートの文字と、ろうそくの本数を入力します（無料）</li>
<li>カートで「受け取り日」と「受け取り時間」を選びます</li>
<li>お支払いを済ませると、ご注文確認メールが届きます</li>
<li>受け取り日に、店頭でお名前をお伝えください</li>
</ol>
<h2>ご予約の締め切り</h2>
<p>受け取り日の3日前までにご予約ください。30日先までご予約いただけます。</p>
<h2>お受け取り</h2>
<p>店頭でのお受け取りのみです。受け取り時間は 11:00〜18:00 です。火曜日は定休日のため、お受け取りできません。</p>
<h2>キャンセル・変更</h2>
<p>受け取り日の3日前までにご連絡ください。それ以降のキャンセルはお受けできません。</p>
<p>※このサイトは架空のサンプル店です。実際の注文・お支払いは発生しません。</p>
'''

ABOUT_HTML = '''
<p>街の小さな洋菓子店「パティスリー こむぎ」です。毎朝、季節のフルーツを使ったケーキと焼き菓子をひとつずつ手作りしています。</p>
<h2>店舗情報</h2>
<ul>
<li>住所：東京都渋谷区サンプル町1-2-3（架空）</li>
<li>営業時間：10:00〜19:00（ケーキのお受け取りは 11:00〜18:00）</li>
<li>定休日：火曜日</li>
</ul>
<p>※このサイトは架空のサンプル店です。実際の店舗はありません。</p>
'''

# (ハンドル, ページ名, 本文)
PAGES = [('guide', 'ご利用ガイド', GUIDE_HTML), ('about', '店舗のご案内', ABOUT_HTML)]

# (ハンドル, コレクション名, 集める商品タイプ, 説明)
COLLECTIONS = [('cakes', 'ケーキ', 'ケーキ', 'お誕生日や記念日に。受け取り日を選んでご予約いただけます。'),
               ('baked-goods', '焼き菓子', '焼き菓子', 'ちょっとした贈り物にぴったりの焼き菓子です。')]

# 店頭受け取りの場所（架空）。
# 「サンプル町1-2-3」は実在しない町名・番地。
# 郵便番号 150-0001 と「東京都・渋谷区」は、Shopify が「都道府県と郵便番号が合っているか」を
# 確かめるので、その入力チェックを通すためだけに入れた形だけの値（この郵便番号に実在のお店はない）。
# 実際のお店で使うときは、管理画面の「設定」→「ロケーション」で本当の住所に直す。
PICKUP_ADDRESS = {
    'countryCode': 'JP',
    'provinceCode': 'JP-13',   # 東京都
    'city': '渋谷区',
    'address1': 'サンプル町1-2-3',
    'zip': '150-0001',         # 入力チェックを通すための形だけの番号（上のコメントを参照）
}
PICKUP_INSTRUCTIONS = 'ご予約の受け取り日・時間に、店頭でお名前をお伝えください。'


# ---------------------------------------------------------------------------
# Shopify を呼ぶ部分
# ---------------------------------------------------------------------------

def store():
    """環境変数 SHOPIFY_STORE の値（対象のストア）"""
    return os.environ.get('SHOPIFY_STORE', '').strip()


def gql(query, variables=None, mutation=False):
    """Shopify CLI で Admin GraphQL を1回呼び、data の中身を返す"""
    cmd = ['shopify', 'store', 'execute', '--store', store(), '--json', '-q', query]
    if variables is not None:
        cmd += ['-v', json.dumps(variables, ensure_ascii=False)]
    if mutation:
        cmd.append('--allow-mutations')
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        sys.exit('shopify コマンドが見つかりません。Shopify CLI を入れてから実行してください。')
    try:
        out = json.loads(res.stdout)
    except json.JSONDecodeError:
        sys.exit('GraphQL の結果が読めませんでした：\n' + res.stdout[-2000:] + res.stderr[-2000:])
    return out.get('data', out)


def user_errors(payload, what):
    """Shopify が userErrors を返したら、内容を出して止める"""
    errs = payload.get('userErrors') or []
    if errs:
        sys.exit(what + ' でエラー：' + json.dumps(errs, ensure_ascii=False))


def staged_upload(paths):
    """画像を Shopify の一時置き場に上げて、{ファイル名: resourceUrl} を返す"""
    data = gql('''mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }''',
               {'input': [{'resource': 'IMAGE', 'filename': os.path.basename(p), 'mimeType': 'image/png',
                           'httpMethod': 'POST', 'fileSize': str(os.path.getsize(p))} for p in paths]},
               mutation=True)
    payload = data['stagedUploadsCreate']
    user_errors(payload, '画像のアップロード準備')
    urls = {}
    for path, target in zip(paths, payload['stagedTargets']):
        cmd = ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', target['url']]
        for p in target['parameters']:
            cmd += ['-F', p['name'] + '=' + p['value']]
        cmd += ['-F', 'file=@' + path]
        code = subprocess.run(cmd, capture_output=True, text=True).stdout
        if not code.startswith('2'):
            sys.exit(os.path.basename(path) + ' を上げられませんでした（' + code + '）')
        urls[os.path.basename(path)] = target['resourceUrl']
    return urls


def need_images(names):
    """images/out/ に必要な PNG があるか確かめ、パスの一覧を返す"""
    paths = [os.path.join(IMAGE_DIR, n + '.png') for n in names]
    missing = [os.path.basename(p) for p in paths if not os.path.exists(p)]
    if missing:
        sys.exit('images/out/ に画像がありません：' + '、'.join(missing)
                 + '\n先に python3 images/make.py と python3 images/make_hero.py を実行してください。')
    return paths


# ---------------------------------------------------------------------------
# products：商品を作る
# ---------------------------------------------------------------------------

def product_input(p, image_url):
    """PRODUCTS の1件を、productSet に渡す形にする"""
    base = {
        'handle': p['handle'], 'title': p['title'], 'descriptionHtml': p['desc'], 'productType': p['type'],
        'vendor': STORE_NAME, 'tags': p['tags'], 'status': 'ACTIVE',
        'files': [{'originalSource': image_url, 'contentType': 'IMAGE', 'alt': p['title'] + '（イラスト）'}],
    }
    if 'prices' in p:
        # ケーキ：テーマの商品テンプレート「cake」を使い、サイズで値段を変える
        base['templateSuffix'] = 'cake'
        base['productOptions'] = [{'name': 'サイズ', 'values': [{'name': s} for s in SIZES]}]
        base['variants'] = [{'optionValues': [{'optionName': 'サイズ', 'name': s}], 'price': str(price),
                             'inventoryPolicy': 'CONTINUE', 'inventoryItem': {'tracked': False, 'requiresShipping': True}}
                            for s, price in zip(SIZES, p['prices'])]
    else:
        base['productOptions'] = [{'name': 'Title', 'values': [{'name': 'Default Title'}]}]
        base['variants'] = [{'optionValues': [{'optionName': 'Title', 'name': 'Default Title'}],
                             'price': str(p['price']),
                             'inventoryPolicy': 'CONTINUE', 'inventoryItem': {'tracked': False, 'requiresShipping': True}}]
    return base


def create_products():
    data = gql('{ products(first: 100) { nodes { handle } } }')
    have = {p['handle'] for p in data['products']['nodes']}
    todo = [p for p in PRODUCTS if p['handle'] not in have]
    if not todo:
        print('商品：すでに全部あります')
        return
    names = sorted({p['image'] for p in todo})
    urls = staged_upload(need_images(names))
    for p in todo:
        data = gql('''mutation($input: ProductSetInput!) { productSet(synchronous: true, input: $input) {
            product { id title } userErrors { field message } } }''',
                   {'input': product_input(p, urls[p['image'] + '.png'])}, mutation=True)
        user_errors(data['productSet'], p['title'])
        print('商品を作りました：', data['productSet']['product']['title'])


# ---------------------------------------------------------------------------
# archive：テスト商品をアーカイブする
# ---------------------------------------------------------------------------

def archive_test_products():
    """Shopify が最初に入れたテスト商品（スノーボードなど）は、消さずにアーカイブして見えなくする"""
    ours = {p['handle'] for p in PRODUCTS}
    data = gql('{ products(first: 100) { nodes { id handle title status } } }')
    for p in data['products']['nodes']:
        if p['handle'] in ours or p['status'] == 'ARCHIVED':
            continue
        res = gql('mutation($input: ProductInput!) { productUpdate(input: $input) { product { id } '
                  'userErrors { field message } } }',
                  {'input': {'id': p['id'], 'status': 'ARCHIVED'}}, mutation=True)
        user_errors(res['productUpdate'], p['title'] + ' のアーカイブ')
        print('アーカイブしました：', p['title'])


# ---------------------------------------------------------------------------
# site：コレクション・ページ・メニュー・店頭受け取り
# ---------------------------------------------------------------------------

def create_collections():
    """商品タイプで自動的に集めるコレクションを作り、{ハンドル: ID} を返す"""
    data = gql('{ collections(first: 50) { nodes { id handle } } }')
    have = {c['handle']: c['id'] for c in data['collections']['nodes']}
    ids = {}
    for handle, title, ptype, desc in COLLECTIONS:
        if handle in have:
            ids[handle] = have[handle]
            continue
        res = gql('''mutation($input: CollectionInput!) { collectionCreate(input: $input) {
            collection { id title } userErrors { field message } } }''',
                  {'input': {'handle': handle, 'title': title, 'descriptionHtml': '<p>' + desc + '</p>',
                             'ruleSet': {'appliedDisjunctively': False,
                                         'rules': [{'column': 'TYPE', 'relation': 'EQUALS', 'condition': ptype}]}}},
                  mutation=True)
        user_errors(res['collectionCreate'], title)
        ids[handle] = res['collectionCreate']['collection']['id']
        print('コレクションを作りました：', title)
    return ids


def create_pages():
    """ご利用ガイド・店舗のご案内のページを作り、{ハンドル: ID} を返す"""
    data = gql('{ pages(first: 50) { nodes { id handle } } }')
    have = {p['handle']: p['id'] for p in data['pages']['nodes']}
    ids = {}
    for handle, title, body in PAGES:
        if handle in have:
            ids[handle] = have[handle]
            continue
        res = gql('''mutation($page: PageCreateInput!) { pageCreate(page: $page) {
            page { id title } userErrors { field message } } }''',
                  {'page': {'handle': handle, 'title': title, 'body': body, 'isPublished': True}}, mutation=True)
        user_errors(res['pageCreate'], title)
        ids[handle] = res['pageCreate']['page']['id']
        print('ページを作りました：', title)
    return ids


def update_menu(collections, pages):
    """ヘッダーのメニュー（main-menu）を、ケーキ屋さん用の並びに置きかえる"""
    data = gql('{ menus(first: 10) { nodes { id handle title } } }')
    menus = [m for m in data['menus']['nodes'] if m['handle'] == 'main-menu']
    if not menus:
        sys.exit('メニュー main-menu が見つかりません')
    menu = menus[0]
    items = [
        {'title': 'ホーム', 'type': 'FRONTPAGE', 'url': '/'},
        {'title': 'ケーキ', 'type': 'COLLECTION', 'resourceId': collections['cakes']},
        {'title': '焼き菓子', 'type': 'COLLECTION', 'resourceId': collections['baked-goods']},
        {'title': 'ご利用ガイド', 'type': 'PAGE', 'resourceId': pages['guide']},
        {'title': '店舗のご案内', 'type': 'PAGE', 'resourceId': pages['about']},
    ]
    res = gql('''mutation($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
        menuUpdate(id: $id, title: $title, items: $items) { menu { id } userErrors { field message } } }''',
              {'id': menu['id'], 'title': menu['title'], 'items': items}, mutation=True)
    user_errors(res['menuUpdate'], 'メニュー')
    print('メニューを更新しました')


def setup_pickup():
    """お店の場所を架空の住所にして、店頭受け取りを有効にする"""
    data = gql('{ locations(first: 10) { nodes { id name } } }')
    locs = [l for l in data['locations']['nodes'] if l['name'] in ('Shop location', STORE_NAME)]
    if not locs:
        sys.exit('ロケーション「Shop location」が見つかりません。管理画面の「設定」→「ロケーション」を確かめてください。')
    loc = locs[0]
    res = gql('''mutation($id: ID!, $input: LocationEditInput!) { locationEdit(id: $id, input: $input) {
        location { id name } userErrors { field message } } }''',
              {'id': loc['id'], 'input': {'name': STORE_NAME, 'address': PICKUP_ADDRESS}}, mutation=True)
    user_errors(res['locationEdit'], 'お店の場所')
    res = gql('''mutation($s: DeliveryLocationLocalPickupEnableInput!) {
        locationLocalPickupEnable(localPickupSettings: $s) {
        localPickupSettings { pickupTime instructions } userErrors { field message } } }''',
              {'s': {'locationId': loc['id'], 'pickupTime': 'TWO_TO_FOUR_DAYS',
                     'instructions': PICKUP_INSTRUCTIONS}}, mutation=True)
    user_errors(res['locationLocalPickupEnable'], '店頭受け取り')
    print('店頭受け取りを有効にしました：', res['locationLocalPickupEnable']['localPickupSettings'])


def setup_site():
    collections = create_collections()
    pages = create_pages()
    update_menu(collections, pages)
    setup_pickup()


# ---------------------------------------------------------------------------
# hero：トップページの看板画像
# ---------------------------------------------------------------------------

def upload_hero():
    """看板画像を「ファイル」に上げる。テーマからは shopify://shop_images/hero.png で使う
    同じ名前があっても上げ直すので、1回だけ実行する"""
    urls = staged_upload(need_images(['hero']))
    data = gql('''mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) {
        files { id fileStatus } userErrors { field message } } }''',
               {'files': [{'originalSource': urls['hero.png'], 'filename': 'hero.png',
                           'contentType': 'IMAGE', 'alt': 'ケーキのイラスト'}]}, mutation=True)
    user_errors(data['fileCreate'], '看板画像の登録')
    print('看板画像を上げました')


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

STEPS = {
    'products': [create_products],
    'archive': [archive_test_products],
    'site': [setup_site],
    'hero': [upload_hero],
    'all': [create_products, archive_test_products, setup_site],
}


def main(argv):
    if len(argv) != 2 or argv[1] not in STEPS:
        print(__doc__)
        return 1
    if not store():
        print('環境変数 SHOPIFY_STORE に、対象のストアを入れてから実行してください。\n'
              '例：export SHOPIFY_STORE=your-store.myshopify.com', file=sys.stderr)
        return 1
    for step in STEPS[argv[1]]:
        step()
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
