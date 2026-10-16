"""Chromium UI harness. Persistence is simulated; real APIs are tested separately.
Run the harness first: npm run dev:e2e. Requires Python Playwright and Chromium.
"""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE=os.environ.get('PULSE_E2E_URL','http://127.0.0.1:4174')
OUT=Path('work/e2e');OUT.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--js-flags=--expose-gc','--enable-precise-memory-info'])
 def open_editor(page,touch=False):
  row=page.locator('[id^="my-song-"]')
  row.tap() if touch else row.click()
  page.get_by_role('button',name='Fixture Song の管理メニュー').click()
  page.get_by_role('menuitem',name='編集',exact=True).click()
  expect(page.get_by_role('dialog',name='楽曲設定',exact=True)).to_be_visible()
  expect(page.get_by_role('button',name='基本情報',exact=True)).to_be_enabled()
 for name,width,height,touch in [('desktop',1280,900,False),('small',320,568,True),('phone',390,844,True),('landscape',844,390,True)]:
  context=browser.new_context(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch,reduced_motion='reduce')
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE)
  expect(page.get_by_role('heading',name='MY TRACKS')).to_be_visible()
  page.evaluate('window.profileBefore=document.getElementById("profile-fixture")')
  open_editor(page,touch)
  dialog=page.get_by_role('dialog',name='楽曲設定',exact=True)
  assert page.evaluate('window.profileBefore===document.getElementById("profile-fixture")')
  expect(page.get_by_role('heading',name='楽曲設定',exact=True)).to_be_focused()
  bounds=dialog.bounding_box();assert bounds and bounds['x']>=0 and bounds['y']>=0 and bounds['x']+bounds['width']<=width+1 and bounds['y']+bounds['height']<=height+1,(name,bounds)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),name
  page.get_by_role('button',name='基本情報',exact=True).click();page.get_by_label('曲名',exact=True).fill('Changed '+name)
  page.get_by_role('button',name='楽曲設定を閉じる').click()
  expect(page.get_by_role('alertdialog',name='変更を破棄しますか？')).to_be_visible()
  page.get_by_role('button',name='編集に戻る',exact=True).click();expect(page.get_by_label('曲名',exact=True)).to_have_value('Changed '+name)
  page.get_by_role('button',name='変更を保存',exact=True).click();page.get_by_role('button',name='確認して保存',exact=True).click()
  expect(page.get_by_text('保存しました',exact=True)).to_be_visible()
  assert page.evaluate('window.songSettingsTest.saveCalls')==1
  page.screenshot(path=str(OUT/(name+'.png')))
  page.get_by_role('button',name='楽曲設定を閉じる').click();expect(dialog).not_to_be_visible()
  expect(page.get_by_role('button',name='Changed '+name+' の管理メニュー')).to_be_focused()
  assert not errors,(name,errors)
  results.append({'case':name,'viewport':[width,height],'modalBounds':bounds,'result':'pass'})
  context.close()
 # Actual Worker/HTMLAudioElement, nullable preview, endpoint 1ms, and timing draft.
 context=browser.new_context(viewport={'width':1280,'height':900});page=context.new_page();page.goto(BASE);open_editor(page)
 page.get_by_role('button',name='音源と波形を準備',exact=True).click()
 expect(page.locator('canvas')).to_have_count(2,timeout=15000)
 expect(page.get_by_text('波形を生成中…',exact=False)).not_to_be_visible(timeout=15000)
 assert page.get_by_text('波形を生成できませんでした:',exact=False).count()==0
 page.get_by_label('開始位置（秒）',exact=True).fill('1.124');expect(page.get_by_role('button',name='変更を保存',exact=True)).to_be_enabled()
 page.get_by_role('region',name='試聴開始位置').get_by_role('button',name='試聴',exact=True).click();page.wait_for_function('window.songSettingsTest.previewStates.includes("playing") && window.songSettingsPreview().status==="ready"')
 assert page.evaluate('window.songSettingsPreview().status')=='ready'
 page.get_by_role('button',name='既定の位置へ戻す',exact=True).click();expect(page.get_by_label('開始位置（秒）',exact=True)).to_have_value('')
 expect(page.get_by_role('button',name='変更を保存',exact=True)).to_be_disabled()
 page.get_by_role('button',name='基本情報',exact=True).click();page.get_by_label('譜面Offset（ms）',exact=True).fill('1')
 page.get_by_role('button',name='変更を保存',exact=True).click();expect(page.get_by_role('button',name='確認して保存',exact=True)).to_be_disabled()
 page.get_by_label('この準備済み音源・譜面を配信する権利を確認しました').check();page.get_by_role('button',name='確認して保存',exact=True).click();expect(page.get_by_text('保存しました',exact=True)).to_be_visible()
 assert page.evaluate('window.songSettingsTest.payload.gameplay.offsetMs')==1
 results.append({'case':'real waveform Worker / short preview end / null reset / timing confirmation','result':'pass'});context.close()
 # Same UUID receipt reconciliation after simulated response loss.
 context=browser.new_context();page=context.new_page();page.goto(BASE);open_editor(page);page.evaluate('window.songSettingsTest.mode="lost"')
 page.get_by_role('button',name='基本情報',exact=True).click();page.get_by_label('曲名',exact=True).fill('Lost response')
 page.get_by_role('button',name='変更を保存',exact=True).click();page.get_by_role('button',name='確認して保存',exact=True).click();expect(page.get_by_text('保存しました',exact=True)).to_be_visible()
 assert page.evaluate('window.songSettingsTest.saveCalls')==1
 results.append({'case':'lost response reconciles one committed receipt','result':'pass'});context.close()
 # Fifty native modal cycles: same profile element, restored focus, no lost scroll lock.
 context=browser.new_context(viewport={'width':1280,'height':900});page=context.new_page();page.goto(BASE)
 page.evaluate('window.profileBefore=document.getElementById("profile-fixture")')
 for cycle in range(50):
  open_editor(page)
  page.get_by_role('button',name='音源と波形を準備',exact=True).click()
  expect(page.locator('canvas')).to_have_count(2)
  if cycle%10==0:
   page.get_by_role('region',name='試聴開始位置').get_by_role('button',name='試聴',exact=True).click()
   page.wait_for_function('window.songSettingsPreview().status==="playing"')
  page.keyboard.press('Escape')
  expect(page.get_by_role('dialog',name='楽曲設定',exact=True)).not_to_be_visible()
  expect(page.get_by_role('button',name='Fixture Song の管理メニュー')).to_be_focused()
  assert page.evaluate('window.profileBefore===document.getElementById("profile-fixture")')
  assert page.evaluate('document.body.style.pointerEvents')!='none'
 results.append({'case':'50 modal/Worker/audio/focus/profile/scroll-lock cycles','result':'pass'});context.close()
 # Native touch double tap plays exactly once; a single tap only selects.
 context=browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True);page=context.new_page();page.goto(BASE)
 row=page.locator('[id^="my-song-"]');row.tap();assert page.evaluate('window.songSettingsTest.plays')==0;row.tap();assert page.evaluate('window.songSettingsTest.plays')==1
 results.append({'case':'native touch single/double tap','result':'pass'});context.close()
 # Each supported codec uses the actual browser Worker and native media metadata.
 context=browser.new_context();page=context.new_page();page.goto(BASE)
 for extension in ['wav','mp3','ogg','opus','m4a','webm']:
  probe=page.evaluate('(extension)=>window.songSettingsCodecProbe(extension)',extension)
  assert probe['durationMs']==1125 and 490<=probe['impulseMs']<=510,probe
  results.append({'case':'browser codec '+extension,'result':'pass',**probe})
 context.close()
 browser.close()
OUT.joinpath('results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False))
