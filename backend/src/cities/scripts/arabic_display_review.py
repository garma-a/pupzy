#!/usr/bin/env python3
"""Reviewed resident-facing display editorial pass; no coordinates or identities change.

Call clean_display_names(list(DIST.values()), DECISIONS) after noise/identity
review and before output/signoff. Mutates display names, aliases and deliberate
ADM3 exclusions/merges in place. Returns the complete audit plus districtEdits.
Raw upstream names are retained in sourceNameArabic/sourceNameEnglish and aliases.
The CLI is a review preview, never a publisher or signoff renewal.
"""
from pathlib import Path
import collections
import copy
import gzip
import json
import math
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / 'src/cities/data/neighbourhoods'

# ADR 0009: full Cairo/Alexandria/Port Said, explicitly selected urban districts,
# and the three districts intersecting the declared North Coast expansion.
EXTRA_COVERED = set('EG1104 EG1906 EG2101 EG2102 EG2103 EG2104 EG2105 EG2106 EG2107 EG2108 EG2109 EG2113 EG2116 EG2117 EG2118 EG2119 EG2120 EG2121 EG1403 EG1406 EG1407 EG1409 EG1410 EG1412 EG1413 EG1309 EG1321 EG1811 EG1812 EG1901 EG1902 EG1903 EG1904 EG1101 EG1102 EG1105 EG1106 EG1108 EG1109 EG3302 EG3307 EG3308'.split())

DISTRICT_NAMES = {'EG1104':'كفر سعد','EG1906':'القنطرة غرب',
 'EG0101':'التبين','EG0102':'حلوان','EG0103':'15 مايو','EG0104':'المعادي','EG0105':'طرة','EG0106':'مصر القديمة','EG0107':'السيدة زينب','EG0108':'الخليفة','EG0109':'عابدين','EG0110':'الموسكي','EG0111':'قصر النيل','EG0112':'بولاق','EG0113':'الأزبكية','EG0114':'الدرب الأحمر','EG0115':'الجمالية','EG0116':'باب الشعرية','EG0117':'الظاهر','EG0118':'الشرابية','EG0119':'شبرا','EG0120':'روض الفرج','EG0121':'الساحل','EG0122':'الوايلي','EG0123':'حدائق القبة','EG0124':'الزيتون','EG0125':'المطرية','EG0126':'مدينة نصر أول','EG0127':'مدينة نصر ثان','EG0128':'مصر الجديدة','EG0129':'النزهة','EG0130':'عين شمس','EG0131':'الزاوية الحمراء','EG0132':'السلام','EG0133':'الزمالك','EG0134':'منشأة ناصر','EG0135':'البساتين','EG0136':'المرج','EG0137':'القاهرة الجديدة أول','EG0138':'القاهرة الجديدة ثان','EG0139':'القاهرة الجديدة ثالث','EG0140':'الشروق','EG0141':'بدر',
 'EG0201':'المنتزه','EG0202':'الرمل أول','EG0203':'سيدي جابر','EG0204':'باب شرقي','EG0205':'محرم بك','EG0206':'العطارين','EG0207':'المنشية','EG0208':'كرموز','EG0209':'اللبان','EG0210':'الجمرك','EG0211':'مينا البصل','EG0212':'الدخيلة','EG0213':'العامرية','EG0214':'برج العرب','EG0215':'ميناء الإسكندرية','EG0216':'برج العرب الجديدة','EG0217':'الرمل ثان','EG0218':'الساحل الشمالي',
 'EG0301':'الشرق','EG0302':'العرب','EG0303':'المناخ','EG0304':'بورفؤاد أول','EG0305':'الضواحي','EG0306':'الجنوب أول','EG0307':'الزهور','EG0308':'بورفؤاد ثان','EG0309':'شرق بورسعيد','EG0310':'المناصرة','EG0311':'الجنوب ثان','EG0312':'ميناء بورسعيد',
 'EG1101':'دمياط أول','EG1102':'دمياط (مركز)','EG1105':'دمياط الجديدة','EG1106':'رأس البر','EG1108':'ميناء دمياط الجديد','EG1109':'دمياط ثان',
 'EG1309':'العاشر من رمضان أول','EG1321':'العاشر من رمضان ثان','EG1403':'الخانكة (مركز)','EG1406':'شبرا الخيمة أول','EG1407':'شبرا الخيمة ثان','EG1409':'قليوب (قسم)','EG1410':'قليوب (مركز)','EG1412':'الخصوص','EG1413':'العبور','EG1811':'كفر الدوار (قسم)','EG1812':'كفر الدوار (مركز)','EG1901':'الإسماعيلية أول','EG1902':'الإسماعيلية ثان','EG1903':'الإسماعيلية ثالث','EG1904':'الإسماعيلية (مركز)',
 'EG2101':'إمبابة (قسم)','EG2102':'العجوزة','EG2103':'الدقي','EG2104':'الجيزة (قسم)','EG2105':'بولاق الدكرور','EG2106':'الأهرام','EG2107':'6 أكتوبر أول','EG2108':'الحوامدية','EG2109':'الجيزة (مركز)','EG2113':'إمبابة (مركز)','EG2116':'أوسيم','EG2117':'الوراق','EG2118':'العمرانية','EG2119':'الشيخ زايد','EG2120':'كرداسة','EG2121':'6 أكتوبر ثان',
 'EG3302':'الحمام','EG3307':'مارينا العلمين','EG3308':'الساحل الشمالي',
}

# Exact source-label spacing corrections. These are editorial spellings of the
# same labels, not a lexicon used to invent a missing Arabic settlement name.
PHRASES = {
 'التبينالبحرية':'التبين البحرية','التبينالقبلية':'التبين القبلية','مساكنالتبينالشعبية':'مساكن التبين الشعبية','المساكنالاقتصادية':'المساكن الاقتصادية',
 'معاديالخبيريالشرقية':'معادي الخبيري الشرقية','معاديالخبيريالغربية':'معادي الخبيري الغربية','معاديالخبيريالوسطي':'معادي الخبيري الوسطى','معاديالسراياتالشرقية':'معادي السرايات الشرقية','معاديالسراياتالغربية':'معادي السرايات الغربية',
 'طرةالأسمنت':'طرة الأسمنت','أثرالنبي':'أثر النبي','الخوخةوالقناية':'الخوخة والقناية','الشيخفراج':'الشيخ فراج','عششالنخل':'عشش النخل','سوقالسلاح':'سوق السلاح','دربالإقماعية':'درب الإقماعية','ابنالرشيد':'ابن الرشيد','العباسيةالقبلية':'العباسية القبلية','جناينالوايلية':'جناين الوايلية','عربأبوطويلة':'عرب أبو طويلة','الحيالعاشر':'الحي العاشر','منطقةالسينما':'منطقة السينما','الحيالسابع':'الحي السابع','الحيالسادس':'الحي السادس','جامعةالأزهر':'جامعة الأزهر','الزاويةالحمراءمساكن':'مساكن الزاوية الحمراء','بركةالنصر':'بركة النصر','البساتينالشرقية':'البساتين الشرقية','البساتينالغربية':'البساتين الغربية','عزبةفهمي':'عزبة فهمي',
 'أبوقيرالشرقية':'أبو قير الشرقية','طلمباتالطابية':'طلمبات الطابية','دناالجديدةوعزبةالوسطانية':'دنا الجديدة وعزبة الوسطانية','ساناستفانو':'سان ستيفانو','الابراهيميةبحريوسيديجابر':'الإبراهيمية بحري وسيدي جابر','الأزاريتووالشاطبي':'الأزاريطة والشاطبي','الحضرةقبلي':'الحضرة قبلي','بابشرقيووابورالمياه':'باب شرقي ووابور المياه','عزبةالجامع':'عزبة الجامع','البابالجديدومنشا':'الباب الجديد ومنشا','أمبروزومحمبك':'أمبروزو ومحرم بك','العطارينشرق':'العطارين شرق','جامعسلطان':'جامع سلطان','الجنينةالصغيرةوكومبكير':'الجنينة الصغيرة وكوم بكير','بابسدرةالجوانيوجنينةالعيونيوالسكونية':'باب سدرة الجواني وجنينة العيوني والسكونية','السيالةشرق':'السيالة شرق','الشمرليوزاويةالأعرج':'الشمرلي وزاوية الأعرج','حارةمدورة':'حارة مدورة','رأسالتين':'رأس التين','زاويةالقبانية':'زاوية القبانية','زاويةخطاب':'زاوية خطاب','سوقالسمكالقديم':'سوق السمك القديم','صفرباشا':'صفر باشا','قبوالملاح':'قبو الملاح','البورصةوكفرعشري':'البورصة وكفر عشري','الورديانشرق':'الورديان شرق','الورديانغرب':'الورديان غرب','الورديانقبلي':'الورديان قبلي','المفروزةشرق':'المفروزة شرق','المفروزةغرب':'المفروزة غرب','طابيةصالح':'طابية صالح','كومالشقافة':'كوم الشقافة','البيطاششرق':'البيطاش شرق','البيطاشغرب':'البيطاش غرب','العجميالبحرية':'العجمي البحرية','العامريةغرب':'العامرية غرب','قطاعالنهضة':'قطاع النهضة','قطاعمريوط':'قطاع مريوط','أبوصير':'أبو صير','الذراعالبحري':'الذراع البحري','الدائرةالجمركية':'الدائرة الجمركية','الظاهريةوعزبةالصفيح':'الظاهرية وعزبة الصفيح','العاقصةوباكوس':'العاقصة وباكوس','زعربانةوالحمام':'زعربانة والحمام',
 'أبوالحسن':'أبو الحسن','الجامعالتوفيقي':'الجامع التوفيقي','الجامعالعباسي':'الجامع العباسي','منتزةسعد':'منتزه سعد','البستانوكفرطبيخة':'البستان وكفر طبيخة','شطالخياطة':'شط الخياطة','شطالشعراء':'شط الشعراء','شطجريبة':'شط جريبة','شطعزبةاللحم':'شط عزبة اللحم','عزبالنهضة':'عزب النهضة','أبوزعبل':'أبو زعبل','عربالعليقات':'عرب العليقات','كفرحمزة':'كفر حمزة','ميتنما':'ميت نما','أبيسالمستجدة':'أبيس المستجدة','سيديغازي':'سيدي غازي','عزبدفشو':'عزب دفشو','قومبانيةأبوقير':'قومبانية أبو قير','قومبانيةلوقين':'قومبانية لوقين','كنجعثمان':'كنج عثمان','كومأشو':'كوم أشو','كومالبركة':'كوم البركة','كومدفشو':'كوم دفشو','معملالزجاج':'معمل الزجاج','منشأةالهلباوي':'منشأة الهلباوي','منشأةعامر':'منشأة عامر','منشأةيونس':'منشأة يونس','أبيس1':'أبيس 1','أبيس3':'أبيس 3','أبيس4':'أبيس 4','أبيس5':'أبيس 5','أبيس6':'أبيس 6','أبوصويرالمحطة':'أبو صوير المحطة','أبوصويرالبلد':'أبو صوير البلد','السبعآبارالشرقية':'السبع آبار الشرقية','السبعآبارالغربية':'السبع آبار الغربية','عينغصين':'عين غصين',
 'جزيرةامبابة':'جزيرة إمبابة','جزيرةميتعقبة':'جزيرة ميت عقبة','حارةأولي':'حارة أولى','حارةثالثة':'حارة ثالثة','حارةثانبة':'حارة ثانية','حارةرابعة':'حارة رابعة','نزلةخلف':'نزلة خلف','نزلةبهجت':'نزلة بهجت','كفرةنصاروفندقميناهاوس':'كفرة نصار وفندق مينا هاوس','نزلةالبطران':'نزلة البطران','نزلةالسمان':'نزلة السمان','الشيخعتمان':'الشيخ عتمان','أمخنان':'أم خنان','زاويةأبومسلم':'زاوية أبو مسلم','ميتشماس':'ميت شماس','ميتقادوس':'ميت قادوس','أمدينار':'أم دينار','بنيسلامة':'بني سلامة','منشيةرضوان':'منشية رضوان','الكومالأحمر':'الكوم الأحمر','زاويةثابت':'زاوية ثابت','طناشونزلةالزمر':'طناش ونزلة الزمر','الكومالأخضر':'الكوم الأخضر','بركالخيام':'برك الخيام','بنيمجدول':'بني مجدول','23يوليو':'23 يوليو',
}

# Restricted whole-word standard orthography. A blanket final ه→ة or ى→ي would
# corrupt names such as عبد الله / طه / مصطفى / يحيى and is deliberately absent.
WORDS = {
 'مدينه':'مدينة','قريه':'قرية','شياخه':'شياخة','حى':'حي','الحى':'الحي','الجديده':'الجديدة','القديمه':'القديمة','الشرقيه':'الشرقية','الغربيه':'الغربية','الشماليه':'الشمالية','الجنوبيه':'الجنوبية','القبليه':'القبلية','البحريه':'البحرية','العربيه':'العربية','العسكريه':'العسكرية','السياحيه':'السياحية','الصناعيه':'الصناعية','الاقتصاديه':'الاقتصادية','التعاونيه':'التعاونية','التعليميه':'التعليمية','الماليه':'المالية','الصحفيه':'الصحفية','الدوليه':'الدولية','الذهبيه':'الذهبية','البلديه':'البلدية','المتميزه':'المتميزة','المسلحه':'المسلحة','القوميه':'القومية','العامه':'العامة','الكبيره':'الكبيرة','الصغيره':'الصغيرة','المركزيه':'المركزية','المقدسه':'المقدسة',
 'القاهره':'القاهرة','الاسكندريه':'الإسكندرية','الاسكندرية':'الإسكندرية','الأسكندرية':'الإسكندرية','الاسماعيليه':'الإسماعيلية','الاسماعيلية':'الإسماعيلية','امبابه':'إمبابة','امبابة':'إمبابة','أمبابة':'إمبابة','المنتزة':'المنتزه','المنتزه':'المنتزه','العامريه':'العامرية','الهواريه':'الهوارية','المعتمديه':'المعتمدية','المعموره':'المعمورة','المندره':'المندرة','المطريه':'المطرية','المحموديه':'المحمودية','السعرانيه':'السعرانية','العكريشه':'العكريشة','الجويره':'الجويرة','النزهه':'النزهة','الزهره':'الزهرة','الصفوه':'الصفوة','الروضه':'الروضة','العزبه':'العزبة','عزبه':'عزبة','هضبه':'هضبة','شركه':'شركة','هيئه':'هيئة','جامعه':'جامعة','اكاديميه':'أكاديمية','أكاديميه':'أكاديمية','اكاديمية':'أكاديمية','الشرطه':'الشرطة','نقابه':'نقابة','جمعيه':'جمعية','الجمعيه':'الجمعية','مؤسسه':'مؤسسة','المحافظه':'المحافظة','الحكومه':'الحكومة','وحده':'وحدة','قناه':'قناة','السكه':'السكة','سكه':'سكة','درباله':'دربالة','سدره':'سدرة','البركه':'البركة','الحلميه':'الحلمية','القربيه':'القربية','الهجانه':'الهجانة','السيده':'السيدة','السيد':'السيد','نفيسه':'نفيسة','جريبه':'جريبة','الانانيه':'العنانية','العنانيه':'العنانية','الواحه':'الواحة','الاسره':'الأسرة','الاشطر':'الأشطر','الاهرام':'الأهرام','الاندلس':'الأندلس','الاندلسيه':'الأندلسية','الازهر':'الأزهر','الاصفر':'الأصفر','الاحمر':'الأحمر','الاخضر':'الأخضر','الاول':'الأول','الاولى':'الأولى','الثانيه':'الثانية','الثالثه':'الثالثة','الرابعه':'الرابعة','الخامسه':'الخامسة','السادسه':'السادسة','السابعه':'السابعة','الثامنه':'الثامنة','التاسعه':'التاسعة','العاشره':'العاشرة','الحاديه':'الحادية','الثاني':'الثاني','ثانبة':'ثانية','اول':'أول','اولي':'أولى','السادس':'السادس','اكتوبر':'أكتوبر','اسكان':'إسكان','الاسكان':'الإسكان','اسكندرية':'إسكندرية','اطلس':'أطلس','الاطباء':'الأطباء','اعضاء':'أعضاء','الاعلام':'الإعلام','الأعلامى':'الإعلامي','الأنتاج':'الإنتاج','الاعمال':'الأعمال','الانشطه':'الأنشطة','المنطقه':'المنطقة','منطقه':'منطقة','الاناجيه':'الإباجية','الإباجيه':'الإباجية','ابو':'أبو','ام':'أم','ابى':'أبي','ابن':'ابن','اسماعيل':'إسماعيل','ابراهيم':'إبراهيم','ابراهام':'أبراهام','احمد':'أحمد','انيس':'أنيس','اميرالد':'إميرالد',
 'سيدى':'سيدي','بحرى':'بحري','قبلى':'قبلي','شرقى':'شرقي','غربى':'غربي','شمالى':'شمالي','جنوبى':'جنوبي','الضواحى':'الضواحي','العجمى':'العجمي','البرانى':'البراني','الجوانى':'الجواني','القومى':'القومي','الصناعى':'الصناعي','الإجتماعي':'الاجتماعي','الإتصالات':'الاتصالات','المستقبلى':'المستقبلي','الوطنى':'الوطني','الديمقراطى':'الديمقراطي','المعادي':'المعادي','المعادى':'المعادي','المساكن':'المساكن','الظباط':'الضباط','عرابى':'عرابي','النوبى':'النوبي','الرياحانى':'الريحاني','الريحانى':'الريحاني','البنهاوى':'البنهاوي','البقلى':'البقلي','الحمزاوى':'الحمزاوي','صفى':'صفي','عيسى':'عيسى','عيسي':'عيسى','المنصوريه':'المنصورية','جزيره':'جزيرة','نزله':'نزلة','شيحه':'شيحة','الخليجيه':'الخليجية','المنوره':'المنورة','الاسباني':'الإسباني','الايطالي':'الإيطالي','السويس':'السويس','موظفى':'موظفي','المدينه':'المدينة','المحليه':'المحلية','للاستثمار':'للاستثمار','للاسكان':'للإسكان','الاجتماعى':'الاجتماعي','الاسراء':'الإسراء','الاشجار':'الأشجار','الاوركيد':'الأوركيد','الاسمرات':'الأسمرات','الامتداد':'الامتداد','الاقصر':'الأقصر','المنيره':'المنيرة','الدبوماسيين':'الدبلوماسيين','الديبلوماسيين':'الدبلوماسيين','ديبلوماسيين':'دبلوماسيين','التطبقيين':'التطبيقيين','الاشراف':'الأشراف','الامان':'الأمان','الساده':'السادة','الساحه':'الساحة','الروضة':'الروضة','انشاص':'إنشاص','الهرم':'الهرم',
}

# Personal post-change 300-row audit spelling residue, applied to whole words.
WORDS.update({'الاحلال':'الإحلال','الخديوى':'الخديوي','ابوصير':'أبو صير','بركه':'بركة','الاخصاص':'الأخصاص','الفواله':'الفوالة','الماظة':'ألماظة','السناقره':'السناقرة','ارض':'أرض','العصاره':'العصارة','صيده':'صيدة','سعاده':'سعادة','العروبه':'العروبة','القابوطى':'القابوطي','الجيوشى':'الجيوشي','القبيسى':'القبيسي','العائلى':'العائلي','البحرى':'البحري','وادى':'وادي','ابراج':'أبراج','القصبجى':'القصبجي','ناى':'ناي','المبيضه':'المبيضة','اسكوت':'إسكوت','ابيس':'أبيس','حميده':'حميدة','على':'علي','الشركه':'الشركة','الدوباره':'الدوبارة','البكباشى':'البكباشي','ريحانه':'ريحانة','التوفيقيه':'التوفيقية','سيتى':'سيتي','العمرانيه':'العمرانية','الحضره':'الحضرة','اشراقه':'إشراقة','طره':'طرة','المعدسه':'المعدسة','الزاويه':'الزاوية','المتحده':'المتحدة','الوايليه':'الوايلية','الكبارى':'الكباري','الناصريه':'الناصرية','الكوبانيه':'الكوبانية','الانجليزيه':'الإنجليزية','الكبري':'الكبرى','الوادى':'الوادي','اتريو':'أتريو','العليمى':'العليمي','منشيه':'منشية','الاوقاف':'الأوقاف','المطافى':'المطافي','ادم':'آدم','حاره':'حارة'})
PHRASES.update({'ارض الواء':'أرض اللواء','أرض الواء':'أرض اللواء'})

# Whole-vocabulary personal residue review; protected final ه/ى names remain unchanged.
WORDS.update({'البكرى': 'البكري', 'كوبرى': 'كوبري', 'القبه': 'القبة', 'السكاكينى': 'السكاكيني', 'الشاطبى': 'الشاطبي', 'ابنى': 'ابني', 'الحادى': 'الحادي', 'الثانى': 'الثاني', 'القطاميه': 'القطامية', 'قتاده': 'قتادة', 'العماليه': 'العمالية', 'المرجوشى': 'المرجوشي', 'عطوه': 'عطوة', 'نفيشه': 'نفيشة', 'بهضبه': 'بهضبة', 'فالى': 'فالي', 'معادى': 'معادي', 'المعصره': 'المعصرة', 'المحطه': 'المحطة', 'كانترى': 'كانتري', 'فيردى': 'فيردي', 'واى': 'واي', 'إبنى': 'ابني', 'هايدى': 'هايدي', 'لاجولى': 'لاجولي', 'البغاله': 'البغالة', 'فاملى': 'فاملي', 'بالرعايه': 'بالرعاية', 'الضبعيه': 'الضبعية', 'الروبيكى': 'الروبيكي', 'القرداحى': 'القرداحي', 'الترسانه': 'الترسانة', 'المفروزه': 'المفروزة', 'القبارى': 'القباري', 'طابيه': 'طابية', 'حياه': 'حياة', 'الجازى': 'الجازي', 'واحه': 'واحة', 'لافندى': 'لافندي', 'وزاره': 'وزارة', 'الرى': 'الري', 'مقاتلى': 'مقاتلي', 'الاهلى': 'الأهلي', 'الرقابه': 'الرقابة', 'الحديقه': 'الحديقة', 'الجمهورى': 'الجمهوري', 'العدويه': 'العدوية', 'كليه': 'كلية', 'السويسرى': 'السويسري', 'صبحى': 'صبحي', 'الكويتيه': 'الكويتية', 'السعوديه': 'السعودية', 'القللى': 'القللي', 'الحجاره': 'الحجارة', 'الرملى': 'الرملي', 'الاميريه': 'الأميرية', 'النهضه': 'النهضة', 'العباسيه': 'العباسية', 'الجبلايه': 'الجبلاية', 'الصعيدى': 'الصعيدي', 'طيبه': 'طيبة', 'عماره': 'عمارة', 'اسكندريه': 'إسكندرية', 'الجمهوريه': 'الجمهورية', 'الشمبكى': 'الشمبكي', 'الاداريه': 'الإدارية', 'غمره': 'غمرة', 'سلامه': 'سلامة', 'الرطلى': 'الرطلي', 'الاقماعيه': 'الإقماعية', 'منيه': 'منية', 'مهمشه': 'مهمشة', 'الخبيرى': 'الخبيري', 'الدراسه': 'الدراسة', 'الخاصه': 'الخاصة', 'الزوايه': 'الزاوية', 'الداوديه': 'الداودية', 'والمنيره': 'والمنيرة', 'الصوابى': 'الصوابي', 'القلايه': 'القلاية', 'المصرى': 'المصري', 'الجزيره': 'الجزيرة', 'العمده': 'العمدة', 'السندبيسى': 'السندبيسي', 'الخليلى': 'الخليلي', 'السروجيه': 'السروجية', 'الشعرانى': 'الشعراني', 'البلاقسه': 'البلاقسة', 'الخازنداره': 'الخازندارة', 'قايتباى': 'قايتباي', 'الباطنيه': 'الباطنية', 'الحسينى': 'الحسيني', 'الصليبه': 'الصليبة', 'هريدى': 'هريدي', 'الترعه': 'الترعة', 'البولاقيه': 'البولاقية', 'القادريه': 'القادرية', 'الاباجيه': 'الإباجية', 'غزيه': 'غزية', 'الجنزورى': 'الجنزوري', 'الخطيرى': 'الخطيري', 'الديوره': 'الديورة', 'العده': 'العدة', 'المناصره': 'المناصرة', 'العمرى': 'العمري', 'رحبه': 'رحبة', 'عائشه': 'عائشة', 'بجامعه': 'بجامعة', 'العدوى': 'العدوي', 'الجياره': 'الجيارة', 'الكردى': 'الكردي', 'القبيله': 'القبيلة', 'المنسى': 'المنسي', 'العيسويه': 'العيسوية', 'الجنينه': 'الجنينة', 'العشماوى': 'العشماوي', 'الفجاله': 'الفجالة', 'حلميه': 'حلمية', 'غزاله': 'غزالة', 'الدويقه': 'الدويقة', 'شجره': 'شجرة', 'منشاه': 'منشأة', 'بنى': 'بني', 'الجلاتمه': 'الجلاتمة', 'الحريه': 'الحرية', 'ونزله': 'ونزلة', 'الزيديه': 'الزيدية', 'الحرانيه': 'الحرانية', 'الشماشرجى': 'الشماشرجي', 'زاويه': 'زاوية', 'الكنيسه': 'الكنيسة', 'اولى': 'أولى', 'غطاطى': 'غطاطي', 'والى': 'والي', 'الناحيه': 'الناحية', 'الحوتيه': 'الحوتية', 'الجزايه': 'الجزاية', 'شنبارى': 'شنباري', 'الطالبيه': 'الطالبية', 'ومنشاه': 'ومنشأة', 'الرهاوى': 'الرهاوي', 'حجازى': 'حجازي', 'البكارى': 'البكاري', 'الزراعى': 'الزراعي', 'الخيمه': 'الخيمة', 'سنه': 'سنة', 'رماده': 'رمادة', 'الغنى': 'الغني', 'المنيه': 'المنية', 'الصينى': 'الصيني', 'حلابه': 'حلابة', 'العيايده': 'العيايدة', 'حمزه': 'حمزة', 'الشافعى': 'الشافعي', 'الصحى': 'الصحي', 'الخانكه': 'الخانكة', 'نسمه': 'نسمة', 'الحملاوى': 'الحملاوي', 'الحربى': 'الحربي', 'منطى': 'منطي', 'الادويه': 'الأدوية', 'الشعاره': 'الشعارة', 'القطاوى': 'القطاوي', 'مزرعه': 'مزرعة', 'محطه': 'محطة', 'البورصه': 'البورصة', 'الشقافه': 'الشقافة', 'قبارى': 'قباري', 'الدكه': 'الدكة', 'كرمله': 'كرملة', 'الهندسه': 'الهندسة', 'الابراهيميه': 'الإبراهيمية', 'الكاره': 'الكارة', 'الطوبجيه': 'الطوبجية', 'سموحه': 'سموحة', 'سكينه': 'سكينة', 'العيونى': 'العيوني', 'الازاريطه': 'الأزاريطة', 'الرحامله': 'الرحاملة', 'الهلاليه': 'الهلالية', 'الماكينه': 'الماكينة', 'الصبحيه': 'الصبحية', 'النوباريه': 'النوبارية', 'زهره': 'زهرة', 'سكره': 'سكرة', 'الشعبيه': 'الشعبية', 'الرياضه': 'الرياضة', 'الشمرلى': 'الشمرلي', 'القصعى': 'القصعي', 'الملاحه': 'الملاحة', 'الفرافره': 'الفرافرة', 'ايجى': 'إيجي', 'الفرنسيه': 'الفرنسية', 'الصينيه': 'الصينية', 'البوسته': 'البوستة', 'القلعه': 'القلعة', 'نهضه': 'نهضة', 'الشعبى': 'الشعبي', 'التجارى': 'التجاري', 'عدلى': 'عدلي', 'فاطمه': 'فاطمة', 'العراوه': 'العراوة', 'اللبانه': 'اللبانة', 'العمرواى': 'العمراوي', 'الاقتصادى': 'الاقتصادي', 'ميامى': 'ميامي', 'الفراعنه': 'الفراعنة', 'الشامى': 'الشامي', 'الفلكى': 'الفلكي', 'بيانكى': 'بيانكي', 'الجوهره': 'الجوهرة', 'الإستثمارى': 'الاستثماري', 'جنه': 'جنة', 'الربوه': 'الربوة', 'الفرنوانى': 'الفرنواني', 'والنادى': 'والنادي', 'النظافه': 'النظافة', 'المدنى': 'المدني', 'حلمى': 'حلمي', 'الرشيدى': 'الرشيدي', 'السياله': 'السيالة', 'العمرانى': 'العمراني', 'الجدبى': 'الجدبي', 'البيومى': 'البيومي', 'بردله': 'بردلة', 'العباسى': 'العباسي', 'مكه': 'مكة', 'البهتيمى': 'البهتيمي', 'العرايشيه': 'العرايشية', 'والكبارى': 'والكباري', 'شحاته': 'شحاتة', 'الجولف-الحى': 'الجولف-الحي', 'هاى': 'هاي', 'دره': 'درة', 'ماى': 'ماي', 'الجنه': 'الجنة', 'ايكينجى': 'إيكينجي', 'اخر': 'آخر', 'احمس': 'أحمس', 'ايستاون': 'إيستاون', 'ارابيلا': 'أرابيلا', 'افينيو': 'أفينيو', 'ايديا': 'إيديا', 'اوركيديا': 'أوركيديا', 'ايدن': 'إيدن', 'ابها': 'أبها', 'ايفوريهيل': 'إيفوريهيل', 'افاريس': 'أفاريس', 'ايزي': 'إيزي', 'ايجلز': 'إيجلز', 'ازاد': 'آزاد', 'اريا': 'آريا', 'ايوب': 'أيوب', 'ايديال': 'إيديال', 'اسبيكو': 'إسبيكو', 'ايجيكو': 'إيجيكو', 'اسعد': 'أسعد', 'امين': 'أمين', 'اتريس': 'أتريس', 'اولاد': 'أولاد', 'اوقاف': 'أوقاف', 'اسكو': 'إسكو', 'امبروز': 'أمبروزو', 'ايكا': 'إيكا', 'امل': 'أمل', 'اشتوم': 'أشتوم', 'اراضي': 'أراضي', 'اكويلا': 'أكويلا', 'اوريون': 'أوريون', 'ارابيسك': 'أرابيسك', 'ايست': 'إيست'})

# Each replacement chooses a resident-recognizable name explicitly present in
# the source label; remaining source components are aliases, never new points.
ADM3_PRIMARY = {
 'EG010604':('الخوخة','Al Khokha',['القناية']),
 'EG011413':('درب شغلان','Darb Shoghlan',['الغريب']),
 'EG013702':('النرجس','El Narges',['المستثمرين الجنوبية']),
 'EG013703':('الياسمين','El Yasmeen',['البنفسج','المستثمرين الشمالية']),
 'EG013704':('الروضة','El Rawda',['الجامعة الأمريكية']),
 'EG013801':('الرحاب','El Rehab',['المستثمرون']),
 'EG013802':('الفردوس','El Fardous',['الكوثر']),
 'EG013803':('الميراج','Mirage',['أكاديمية الشرطة']),
 'EG014102':('الحي الأول','1st District',['الحديقة المركزية']),
 'EG014103':('الحي الثاني','2nd District',['منطقة الامتداد المستقبلي']),
 'EG014104':('الحي الثالث','3rd District',['المنطقة الترفيهية']),
 'EG020105':('السيوف قبلي','El Seyouf Qebly',['عزبة دربالة']),
 'EG020110':('المندرة قبلي','Mandara Qebly',['عزبة الجبل']),
 'EG020201':('القصعي بحري','El Qasaa Bahary',['القصعي بحري سكة حديد أبو قير']),
 'EG020203':('دنا الجديدة','New Dana',['عزبة الوسطانية']),
 'EG020401':('الإبراهيمية بحري','Ibrahimia Bahary',['سيدي جابر']),
 'EG020402':('الإبراهيمية قبلي','Ibrahimia Qebly',['الحضرة بحري']),
 'EG020403':('الأزاريطة','Azarita',['الشاطبي']),
 'EG020405':('باب شرقي','Bab Sharqi',['وابور المياه']),
 'EG020502':('الباب الجديد','El Bab El Gedid',['منشا']),
 'EG020504':('أمبروزو','Ambrozo',['محرم بك']),
 'EG020507':('أبيس','Abis',['أبيس 7','أبيس 8','أبيس 9','أبيس 10']),
 'EG020901':('اللبان','El Labban',['الجدد','الورشة']),
 'EG020902':('الجنينة الصغيرة','El Genina El Saghira',['كوم بكير']),
 'EG020909':('باب سدرة الجواني','Bab Sidra El Gowwani',['جنينة العيوني','السكونية']),
 'EG021009':('الشمرلي','El Shamarli',['زاوية الأعرج']),
 'EG021101':('البورصة','El Borsa',['كفر عشري']),
 'EG021304':('العجمي القبلية','Agami Qebly',['أم زغيو']),
 'EG021308':('النهضة','El Nahda',[]),'EG021309':('مريوط','Mariout',[]),
 'EG021701':('أبيس','Abis',['خورشيد']),
 'EG021702':('الظاهرية','El Zaheriya',['عزبة الصفيح']),
 'EG021703':('العاقصة','El Aqsa',['باكوس']),
 'EG021706':('زعربانة','Zaarbana',['الحمام']),
 'EG030601':('الصديق','El Siddiq',['قرى الجنوب']),
 'EG031001':('المناصرة','El Manasra',['مطار الجميل','طريق دمياط بورسعيد']),
 'EG110202':('البستان','El Bostan',['كفر طبيخة']),
 'EG210205':('مدينة الأوقاف','Awqaf City',['الإعلام']),
 'EG210501':('أبو قتادة','Abu Qatada',['نوفل الجديدة','نوفل القديمة']),
 'EG210603':('كفرة نصار','Kafret Nassar',['مينا هاوس']),
 'EG211701':('الوراق','Warraq',['وراق العرب','وراق الحضر','أنبو']),
 'EG211712':('طناش','Tannash',['نزلة الزمر']),
 'EG330201':('الحمام','Al Hammam',[]),
}

# Composite OSM display labels: same source object/point; no splitting.
SOURCE_PRIMARY = {
 'OSM:way/744290199':('الجنينة الصغيرة','El Genina El Saghira',['كوم بكير','Kom Baker']),
 'OSM:way/745355801':('وابور المياه','Wabour Al Meyah',['باب شرقي','Bab Sharqi']),
 'OSM:way/746915320':('الإبراهيمية قبلي','Ibrahimia Qebly',['الحضرة بحري','Hadara Bahary']),
 'OSM:way/718432322':('طناش','Tannash',['نزلة الزمر','Nazlet El Zomor']),
 'OSM:way/741923535':('المسلة غرب','Al Masala West',['شريف باشا','Sherif Basha']),
 'OSM:way/740670393':('مصطفى كامل','Mostafa Kamel',['بولوكلي','Bolkly','Bolokly']),
 'OSM:way/740708486':('أمبروزو','Ambrozo',['محرم بك','Moharam Bek']),
 'OSM:way/701134776':('التعاونيات','Cooperatives',['مساكن الطوب الرملي','Al Toub Al Ramli Housing']),
 'OSM:way/744555703':('أبيس','Abis',['أبيس 7','أبيس 8','أبيس 10']),
 'OSM:way/750415695':('باب سدرة البراني بحري','Bab Sidra El Barrani Bahary',['سوق الغنم','Souq Al Ghanm']),
 'OSM:way/752983677':('العباسي','El Abbasi',['الجامع العباسي']),
 'OSM:way/752983679':('التوفيقي','El Tawfiqi',['الجامع التوفيقي']),
 'OSM:way/693286669':('الإسكان الاجتماعي','Social Housing',['الإسكان الاجتماعي 2 و3']),
 'OSM:way/920677531':('الأندلس المتميز','Andalous Motamayez',['الأندلس المتميز 2/2']),
 'OSM:way/651095668':('العجمي القبلية','Agami Qebly',['أم زغيو']),
}

ORDINAL_WORDS = {1:'الأول',2:'الثاني',3:'الثالث',4:'الرابع',5:'الخامس',6:'السادس',7:'السابع',8:'الثامن',9:'التاسع',10:'العاشر',11:'الحادي عشر',12:'الثاني عشر',13:'الثالث عشر',14:'الرابع عشر',15:'الخامس عشر',16:'السادس عشر',17:'السابع عشر',18:'الثامن عشر',19:'التاسع عشر',20:'العشرون',21:'الحادي والعشرون',22:'الثاني والعشرون',23:'الثالث والعشرون',24:'الرابع والعشرون',25:'الخامس والعشرون',26:'السادس والعشرون',27:'السابع والعشرون',28:'الثامن والعشرون',29:'التاسع والعشرون',30:'الثلاثون',31:'الحادي والثلاثون',32:'الثاني والثلاثون',33:'الثالث والثلاثون',34:'الرابع والثلاثون',35:'الخامس والثلاثون'}
PROTECTED_PREFIX = {'كمبوند الخدمات','مساكن شيراتون','عزبة النخل','حي المال والأعمال','مدينة نصر','مدينة العمال','مدينة المبعوثين','مدينة الضباط','مدينة الأوقاف','مدينة الإنتاج الإعلامي','مدينة الفنون والثقافة','مدينة مصر الدولية للألعاب الأولمبية'}
PROTECTED_ENGLISH = {'Utilities Compound','City Center','City Centre','Center City','Central Business District','Smart Village','Nasr City','Garden City','Media Production City','City Of Workers','City of workers','District 5 Compound','District 5','Al Abtal City For Armed Forces Housing'}


def normalized(value):
    value=unicodedata.normalize('NFKC',value)
    value=re.sub('[ؐ-ًؚ-ٰٟۖ-ۭـ]','',value).translate(str.maketrans('أإآٱةىؤئ٠١٢٣٤٥٦٧٨٩','ااااهيوي0123456789')).lower()
    return re.sub(r'[^\w]','',value)


def orthography(value):
    value=unicodedata.normalize('NFKC',value).strip()
    for old,new in sorted(PHRASES.items(),key=lambda item:-len(item[0])):
        value=value.replace(old,new)
    value=re.sub(r'\s+',' ',value)
    return ' '.join(WORDS.get(word,word) for word in value.split())


def _base(value):
    # Existing qualifiers are separately re-rendered from their identity proof.
    return value.split(' — ')[0].strip()


def _point(row):
    return [row['point']['longitude'],row['point']['latitude']] if row.get('point') else [row['longitude'],row['latitude']]


def _distance(a,b):
    ax,ay=_point(a);bx,by=_point(b);rad=math.pi/180
    h=math.sin((by-ay)*rad/2)**2+math.cos(ay*rad)*math.cos(by*rad)*math.sin((bx-ax)*rad/2)**2
    return 6371008.8*2*math.atan2(math.sqrt(h),math.sqrt(1-h))


def clean_display_names(districts, decisions, review_path=None):
    covered={r['sourceCode'] for r in districts if r['governorateCode'] in {'EG01','EG02','EG03'} or r['sourceCode'] in EXTRA_COVERED}
    by_code={r['sourceCode']:r for r in [*districts,*decisions]}
    before={r['sourceCode']:{'nameArabic':r.get('nameArabic'),'nameEnglish':r.get('nameEnglish'),'decision':r.get('decision','district')} for r in [*districts,*decisions]}
    events=[];counts=collections.Counter(); exclusions=[];conflicts=[]
    def mark(row,rule,arabic=None,english=None,aliases=(),note=''):
        olda=row['nameArabic'];oldb=row['nameEnglish']
        if arabic is not None:row['nameArabic']=arabic
        if english is not None:row['nameEnglish']=english
        if olda==row['nameArabic'] and oldb==row['nameEnglish'] and not aliases:return
        row.setdefault('aliases',[]).extend([olda,oldb,*aliases])
        row.setdefault('provenance',{}).setdefault('displayReviewRules',[]).append(rule)
        events.append({'sourceCode':row['sourceCode'],'rule':rule,'beforeArabic':olda,'afterArabic':row['nameArabic'],'beforeEnglish':oldb,'afterEnglish':row['nameEnglish'],'notes':note})
        counts[rule]+=1
    for row in districts:
        if row['sourceCode'] in covered:
            if row['sourceCode'] not in DISTRICT_NAMES:raise ValueError('Unreviewed covered district '+row['sourceCode'])
            mark(row,'district-resident-arabic',DISTRICT_NAMES[row['sourceCode']],aliases=[row.get('sourceNameArabic','')],note='Resident name; official OCHA string remains sourceNameArabic and an alias. Kind/ordinal disambiguation matches the official district identity.')
    included=[r for r in decisions if r['decision']=='include']
    # Preserve raw upstream source names before any presentation edits.
    for row in included:
        row.setdefault('sourceNameArabic',row['nameArabic']);row.setdefault('sourceNameEnglish',row['nameEnglish'])
    for row in included:
        if not row['sourceCode'].startswith('PUPZY:adm3-'):continue
        a=orthography(row['nameArabic'])
        ordinal_only=bool(re.match(r'^(?:الشياخة|شياخة)\s+(?:(?:قسم\s+)?(?:أول|ثان|ثالث|رابع|الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|العاشرة|الحادية عشر|الثانية عشر))\b',a)) or bool(re.fullmatch(r'شياخة (?:الشروق|بدر) [12]',a))
        if ordinal_only:
            siblings=[r for r in included if r is not row and r.get('districtSourceCode')==row['districtSourceCode'] and not re.match(r'^(?:الشياخة|شياخة)\s+(?:قسم\s+)?(?:أول|ثان|ثالث|رابع|الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|العاشرة|الحادية|الثانية)',orthography(r['nameArabic']))]
            if siblings:
                row.update(decision='exclude',rule='adm3-ordinal-administrative-label',notes='Reviewed 2026-11-10: ordinal-only administrative shiakha, not a resident area; ADM2 has other named Neighbourhoods. Original source label retained in review.')
                exclusions.append({'sourceCode':row['sourceCode'],'rule':row['rule'],'nameArabic':row['nameArabic'],'nameEnglish':row['nameEnglish'],'districtSourceCode':row['districtSourceCode'],'otherNamedNeighbourhoods':len(siblings)})
                counts[row['rule']]+=1
                continue
            parent=by_code[row['districtSourceCode']]
            short=re.sub(r'^(?:الشياخة|شياخة)\s+(?:قسم\s+)?','',a)
            mark(row,'adm3-sole-child-qualified',parent['nameArabic']+' — '+short,parent['nameEnglish']+' — '+row['nameEnglish'],note='Ordinal source unit retained only because the district has no other named Neighbourhood.')
        code=row['sourceCode'].split('adm3-')[-1].upper()
        if code in ADM3_PRIMARY:
            a,b,aliases=ADM3_PRIMARY[code]
            mark(row,'adm3-primary-resident-name',a,b,aliases,note='Primary locality named in the OCHA label; combined-unit centre unchanged; other source components retained only as aliases, with no split points.')
    included=[r for r in decisions if r['decision']=='include']
    for row in included:
        corrected_en=re.sub(r'\bComound\b','Compound',row['nameEnglish'],flags=re.I)
        if corrected_en!=row['nameEnglish']:mark(row,'english-source-type-spelling',english=corrected_en,note='Corrected generic Compound type typo; original English source spelling remains an alias.')
        a=orthography(row['nameArabic'])
        a=re.sub(r'^شياخة\s+','',a)
        if row['sourceCode'] in SOURCE_PRIMARY:
            pa,pb,aliases=SOURCE_PRIMARY[row['sourceCode']]
            mark(row,'source-primary-resident-name',pa,pb,aliases,note='Single source object retained at its recorded point; secondary source component remains an alias.')
            a=pa
        # Literal numbered districts use Arabic ordinal words; aliases keep digits.
        match=re.match(r'^((?:(?:شمال|جنوب|شرق|غرب)\s+)?)(?:الحي|حي)\s*([0-9٠-٩]{1,2})(?![0-9٠-٩])(.*)$',a)
        if match:
            number=int(match[2].translate(str.maketrans('٠١٢٣٤٥٦٧٨٩','0123456789')))
            row.setdefault('aliases',[]).append(a)
            if number in ORDINAL_WORDS:a=match[1]+'الحي '+ORDINAL_WORDS[number]+match[3]
        if a!=row['nameArabic']:mark(row,'arabic-standard-orthography',a,note='Restricted reviewed phrase/word corrections and Arabic ordinal spelling; original source labels retained.')
        city_contexts={'EG0103':('15 مايو','15th of May'),'EG0126':('مدينة نصر أول','Nasr City First'),'EG0127':('مدينة نصر ثان','Nasr City Second'),'EG0137':('القاهرة الجديدة','New Cairo'),'EG0138':('القاهرة الجديدة','New Cairo'),'EG0139':('القاهرة الجديدة','New Cairo'),'EG0140':('الشروق','Shorouk'),'EG0141':('بدر','Badr'),'EG2107':('6 أكتوبر','October'),'EG2121':('6 أكتوبر','October'),'EG2119':('الشيخ زايد','Sheikh Zayed'),'EG1413':('العبور','Obour'),'EG1309':('العاشر من رمضان','10th of Ramadan'),'EG1321':('العاشر من رمضان','10th of Ramadan'),'EG0216':('برج العرب الجديدة','New Borg El Arab'),'EG1105':('دمياط الجديدة','New Damietta')}
        if row['districtSourceCode'] in city_contexts and re.match(r'^(?:(?:شمال|جنوب|شرق|غرب)\s+)?(?:الحي|حي)\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي|العشرون|الثلاثون)',row['nameArabic']) and ' — ' not in row['nameArabic'] and not row.get('provenance',{}).get('nameDisambiguation'):
            ac,bc=city_contexts[row['districtSourceCode']]
            be=row['nameEnglish'] if ' (' in row['nameEnglish'] else row['nameEnglish']+' ('+bc+')'
            mark(row,'numbered-district-city-context',row['nameArabic']+' — '+ac,be,note='Literal numbered district always identifies its sourced enclosing new city in both languages.')

    included=[r for r in decisions if r['decision']=='include']
    # Prefix proposals are decided simultaneously, so iteration order cannot hide
    # a collision caused by two separate features shedding a place-type label.
    proposals={}
    for row in included:
        a=row['nameArabic'];b=row['nameEnglish'];pa=a;pb=b
        if row.get('provenance',{}).get('institutionalHousingReview'):
            proposals[row['sourceCode']]=(pa,pb)
            counts['institutional-prefix-retained']+=1
            continue
        if not any(_base(a)==prefix or _base(a).startswith(prefix+' ') for prefix in PROTECTED_PREFIX) and not re.match(r'^(?:الحي|حي)\s+(?:السكني\s+)?(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي|العشرون|الثلاثون)',a):
            pa=re.sub(r'^(?:قرية|مدينة|كمبوند|كومبوند|كومباوند|حي|مساكن|منطقة)\s+','',a)
        # Keep source-bound district words for numeric ordinals and proper brands.
        if not (pa==a and re.match(r'^(?:الإسكان|إسكان|مساكن|مدينة|قرية|كمبوند|القرية|المدينة|الحي)\s+',a)) and not any(_base(a)==prefix or _base(a).startswith(prefix+' ') for prefix in PROTECTED_PREFIX) and b not in PROTECTED_ENGLISH and not re.match(r'^\d+(?:st|nd|rd|th) District\b',b,re.I):
            pb=re.sub(r'^(?:The village of|Qaryah|Qaryat|Village|District|City of|City|Compound|Housing)\s+','',b,flags=re.I)
            suffixes='Compound|Comound' if 'سيتي' in a else 'Village|City|Compound|Comound|District|Housing'
            pb=re.sub(r'\s+(?:'+suffixes+r')(?=\s*\(|$)','',pb,flags=re.I)
        proposals[row['sourceCode']]=(pa,pb)
    for row in included:
        pa,pb=proposals[row['sourceCode']]
        if pa==row['nameArabic'] and pb==row['nameEnglish']:continue
        others=[r for r in [*districts,*included] if r is not row and r['governorateCode']==row['governorateCode']]
        collision=any(normalized(pa)==normalized(proposals.get(r['sourceCode'],(r['nameArabic'],r['nameEnglish']))[0]) or pb.lower()==proposals.get(r['sourceCode'],(r['nameArabic'],r['nameEnglish']))[1].lower() for r in others)
        if collision:
            counts['prefix-retained-for-uniqueness']+=1
            continue
        mark(row,'generic-place-type-prefix-removed',pa,pb,note='OSM feature-type prefix/suffix removed in both languages only where the proposed resident name remains unique in the governorate; source label remains alias.')
    # An ADM3 label collapsed to its existing official district is an identity
    # merge, not an independently named neighbourhood at an arbitrary centre.
    for row in included:
        if not row['sourceCode'].startswith('PUPZY:adm3-'):continue
        matches=[r for r in districts if r['governorateCode']==row['governorateCode'] and normalized(r['nameArabic'].split(' (')[0])==normalized(row['nameArabic'])]
        if len(matches)==1:
            target=matches[0]
            target.setdefault('aliases',[]).extend([row['nameArabic'],row['nameEnglish'],row['sourceNameArabic'],row['sourceNameEnglish'],*row.get('aliases',[])])
            row.update(decision='merge',mergeInto=target['sourceCode'],rule='adm3-primary-district-identity',notes='Reviewed source primary name is the existing official district; aliases retained on that district without adding a second selectable identity.')
            counts[row['rule']]+=1
            exclusions.append({'sourceCode':row['sourceCode'],'rule':row['rule'],'mergeInto':target['sourceCode'],'nameArabic':row['nameArabic'],'nameEnglish':row['nameEnglish']})
    included=[r for r in decisions if r['decision']=='include']
    # Newly exposed same-locality ADM3/OSM identities are merged rather than
    # inventing qualifiers for duplicate selectable names at unit centres.
    for row in included:
        if row['sourceCode'] not in {'PUPZY:adm3-eg021702','PUPZY:adm3-eg021706','PUPZY:adm3-eg021403','PUPZY:adm3-eg021410','PUPZY:adm3-eg020902','PUPZY:adm3-eg012701','PUPZY:adm3-eg012702'}: continue
        matches=[other for other in included if other['sourceCode'].startswith('OSM:') and
                 other['districtSourceCode']==row['districtSourceCode'] and
                 normalized(_base(other['nameArabic']))==normalized(_base(row['nameArabic']))]
        if len(matches)==1 and _distance(row,matches[0]) <= 5000:
            target=matches[0]
            target.setdefault('aliases',[]).extend([row['nameArabic'],row['nameEnglish'],*row.get('aliases',[])])
            row.update(decision='exclude',rule='adm3-primary-existing-locality',duplicateOf=target['sourceCode'],
              notes='Reviewed same resident primary locality and official district already represented by '+target['sourceCode']+'; retain source aliases there.')
            exclusions.append({'sourceCode':row['sourceCode'],'rule':row['rule'],'mergeInto':target['sourceCode']})
            counts[row['rule']]+=1
    included=[r for r in decisions if r['decision']=='include']
    for row in included:
        if not row.get('provenance',{}).get('institutionalHousingReview'): continue
        parent=by_code[row['districtSourceCode']]
        a=_base(row['nameArabic'])+' — '+parent['nameArabic']
        b=row['nameEnglish'].split(' (')[0]+' ('+parent['nameEnglish']+')'
        mark(row,'institutional-housing-qualified',a,b,note='Retained named staff housing with an explicit district qualifier in both languages.')
    # Render existing source-backed English context facts in Arabic.
    arabic_bases={r['sourceCode']:_base(r['nameArabic']) for r in [*districts,*included]}
    english_bases={r['sourceCode']:r['nameEnglish'].split(' (')[0] for r in [*districts,*included]}
    direction_map={'north':'شمال','north-east':'شمال شرق','east':'شرق','south-east':'جنوب شرق','south':'جنوب','south-west':'جنوب غرب','west':'غرب','north-west':'شمال غرب'}
    for row in included:
        proof=row.get('provenance',{}).get('nameDisambiguation')
        if row.get('provenance',{}).get('institutionalHousingReview'):continue
        if not proof or proof.get('district') not in by_code:continue
        context=arabic_bases[proof['district']]
        ref=proof.get('contextCitySourceCode')
        if ref and ref in arabic_bases:
            en=row['nameEnglish'];direction=next((v for k,v in direction_map.items() if ', '+k+' of ' in en),None)
            context+=('، '+direction+' ' if direction else '، قرب ')+arabic_bases[ref]
        mark(row,'arabic-mirrors-english-context',arabic_bases[row['sourceCode']]+' — '+context,note='Arabic uses exactly the district and source-backed reference facts already carried by the English disambiguation proof.')
    # Remaining Arabic-only collisions get the same reviewed qualifier in both
    # languages. Near-reference descriptions are presentation, not new places.
    # One collision component covers either language, including an English
    # collision exposed by different Arabic renderings of the same city context.
    identity_rows=[*districts,*included]
    union={r['sourceCode']:r['sourceCode'] for r in identity_rows}
    def leader(code):
        while union[code]!=code:
            union[code]=union[union[code]];code=union[code]
        return code
    seen_names={}
    for row in identity_rows:
        for language in ['nameArabic','nameEnglish']:
            key=(row['governorateCode'],language,normalized(row[language]))
            if key in seen_names:union[leader(row['sourceCode'])]=leader(seen_names[key])
            else:seen_names[key]=row['sourceCode']
    groups=collections.defaultdict(list)
    for row in identity_rows:groups[leader(row['sourceCode'])].append(row)
    for group in groups.values():
        if len(group)<2:continue
        for row in group:
            if row in districts:
                conflicts.append({'sourceCode':row['sourceCode'],'nameArabic':row['nameArabic'],'reason':'District display collision requires explicit reviewed identity decision'})
                continue
            parent=by_code[row['districtSourceCode']];a_context=arabic_bases[parent['sourceCode']];b_context=parent['nameEnglish'];proof={'district':parent['sourceCode']}
            siblings=[r for r in group if r.get('districtSourceCode')==row['districtSourceCode']]
            if len(siblings)>1:
                references=[r for r in included if r not in group and r['governorateCode']==row['governorateCode'] and normalized(arabic_bases[r['sourceCode']])!=normalized(arabic_bases[row['sourceCode']])]
                references.sort(key=lambda r:(_distance(row,r),r['sourceCode']))
                used=set()
                for sibling in siblings:
                    if sibling is row:break
                    prior=sibling.get('provenance',{}).get('arabicNameDisambiguation',{})
                    if prior.get('contextCitySourceCode'):used.add(normalized(arabic_bases[prior['contextCitySourceCode']]))
                ref=next((r for r in references if normalized(arabic_bases[r['sourceCode']]) not in used),None)
                if not ref:conflicts.append({'sourceCode':row['sourceCode'],'reason':'No named reference for same-parent Arabic collision'});continue
                km=_distance(row,ref)/1000
                a_context+='، قرب '+arabic_bases[ref['sourceCode']];b_context+=', near '+english_bases[ref['sourceCode']]
                proof.update(contextCitySourceCode=ref['sourceCode'],contextPointDistanceKm=round(km,3))
            old_b=row['nameEnglish'];base_b=old_b.split(' (')[0] if row.get('provenance',{}).get('nameDisambiguation') else old_b
            row.setdefault('provenance',{})['arabicNameDisambiguation']=proof
            mark(row,'arabic-governorate-uniqueness',arabic_bases[row['sourceCode']]+' — '+a_context,base_b+' ('+b_context+')',note='Same district/reference qualifier in both languages; bare and upstream forms remain aliases. No coordinate or identity change.')
    # Clean aliases only for emptiness/exact duplicate; do not discard source
    # strings merely because they contain numbers or administrative wording.
    for row in [*districts,*included]:
        seen={row['nameArabic'].casefold(),row['nameEnglish'].casefold()};aliases=[]
        for value in row.get('aliases',[]):
            value=str(value).strip()
            if value and value.casefold() not in seen and len(value)<=100:seen.add(value.casefold());aliases.append(value)
        row['aliases']=aliases
    finalgroups=collections.defaultdict(list)
    for row in [*districts,*included]:finalgroups[row['governorateCode'],normalized(row['nameArabic'])].append(row['sourceCode'])
    remaining=[{'governorateCode':k[0],'normalizedArabic':k[1],'sourceCodes':v} for k,v in finalgroups.items() if len(v)>1]
    district_edits=[{'sourceCode':r['sourceCode'],'nameEnglish':r['nameEnglish'],'nameArabic':r['nameArabic'],'aliases':r.get('aliases',[]),'notes':'Reviewed resident-facing Arabic and source-backed spelling aliases; upstream source name, source identity and coordinates unchanged.'} for r in districts if r['sourceCode'] in covered]
    examples={label:[e for e in events if e['rule'] in rules][:10] for label,rules in {'districts':{'district-resident-arabic'},'prefixes':{'generic-place-type-prefix-removed'},'adm3':{'adm3-primary-resident-name'},'uniqueness':{'arabic-mirrors-english-context','arabic-governorate-uniqueness'}}.items()}
    report={'metadata':{'reviewed':True,'reviewDate':'2026-11-11','method':'Explicit source-label resident-name review plus restricted orthography dictionary; no coordinates, UUIDs or source codes changed. Raw source labels remain sourceName fields and aliases. Sole-child ordinal exception applied by district child count.'},'coveredDistrictSourceCodes':sorted(covered),'counts':dict(counts),'changes':events,'exclusions':exclusions,'conflicts':conflicts,'remainingArabicCollisions':remaining,'districtEdits':district_edits,'examples':examples}
    if review_path:
        Path(review_path).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--decisions',default=str(ROOT/'output/neighbourhood-cities/bulk-decisions.json'))
    parser.add_argument('--catalog',default=str(ROOT/'output/neighbourhood-cities/candidate-catalog.json'))
    parser.add_argument('--review',default=str(DATA/'arabic-display-review.json'))
    args=parser.parse_args()
    catalog=json.loads(Path(args.catalog).read_text());decisions=json.loads(Path(args.decisions).read_text());districts=[copy.deepcopy(r) for r in catalog['records'] if not r.get('districtSourceCode')]
    report=clean_display_names(districts,decisions,args.review)
    out=ROOT/'output/neighbourhood-cities'
    (out/'arabic-display-decisions-preview.json').write_text(json.dumps(decisions,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'coveredDistricts':len(report['coveredDistrictSourceCodes']),'counts':report['counts'],'remainingArabicCollisions':report['remainingArabicCollisions'],'conflicts':report['conflicts']},ensure_ascii=False,indent=2))
