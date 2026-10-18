# Verified model identities (from local artifacts)

Generated: 2026-10-14T00:20:25.618680+00:00

Architecture claims below come from `joblib.load` of serving pointers, not filenames.

## C4 topic classification (NL closed-set) — also exposed as chat topic hint; not C2

- **run_id:** `c4_topic_nl_20261013T105116_04964504`
- **path:** `backend/ml/artifacts/c4/c4_topic_nl_20261013T105116_04964504/topic_nl_classifier.joblib`
- **sha256:** `ecc4220b80c96bfd31d5bea06628271ce19649e4f18666355a28e6cfd41d6b82`
- **estimator:** `sklearn.linear_model._logistic.LogisticRegression`
- **steps:** `[{'name': 'tfidf', 'class': 'sklearn.feature_extraction.text.TfidfVectorizer'}, {'name': 'clf', 'class': 'sklearn.linear_model._logistic.LogisticRegression'}]`
- **endpoint:** `POST /v1/topic/classify`
- **architecture:** sklearn Pipeline(TfidfVectorizer → LogisticRegression). NOT DistilBERT / transformers.

## C1 OULAD behaviour clustering

- **run_id:** `c1_20261013T030329_134eeb26`
- **path:** `backend/ml/artifacts/c1/c1_20261013T030329_134eeb26/kmeans_pipeline.joblib`
- **sha256:** `ba9c92e82bf58f71fa2c67d28024b1313b9d28c83288bb20acb2f53abfea8987`
- **estimator:** `sklearn.pipeline.Pipeline`
- **steps:** `[{'name': 'scaler', 'class': 'sklearn.preprocessing._data.StandardScaler'}, {'name': 'kmeans', 'class': 'sklearn.cluster._kmeans.KMeans'}]`
- **endpoint:** `POST /v1/behaviour/cluster`

## C2 EdNet correctness v2

- **run_id:** `c2_ednet_v2_20261013T153128_f83023f6`
- **path:** `backend/ml/artifacts/c2/c2_ednet_v2_20261013T153128_f83023f6/correctness_pipeline.joblib`
- **sha256:** `5fe584c752497fd35394d0f1bd23615439a2ed5621d64291ea32b7a333f0aa73`
- **estimator:** `sklearn.pipeline.Pipeline`
- **steps:** `[{'name': 'scaler', 'class': 'sklearn.preprocessing._data.StandardScaler'}, {'name': 'clf', 'class': 'sklearn.linear_model._logistic.LogisticRegression'}]`
- **endpoint:** `POST /v1/correctness/predict`

## C2 Arts simulation ranker (opt-in)

- **run_id:** `c2_rank_rev_20261013T105157_40d91e8c`
- **path:** `backend/ml/artifacts/c2/c2_rank_rev_20261013T105157_40d91e8c/ranker_pointwise.joblib`
- **sha256:** `3eed7793713963c641aa09e1216242a35f8b3e39a944ac696bd001fe082ce62d`
- **estimator:** `sklearn.pipeline.Pipeline`
- **steps:** `[{'name': 'scaler', 'class': 'sklearn.preprocessing._data.StandardScaler'}, {'name': 'clf', 'class': 'sklearn.linear_model._logistic.LogisticRegression'}]`
- **endpoint:** `POST /v1/recommendations/score (Express opt-in trained_ranker)`

## C3 OULAD academic risk

- **run_id:** `c3_oulad_20261013T030421_2f6e0ea2`
- **path:** `backend/ml/artifacts/c3/c3_oulad_20261013T030421_2f6e0ea2/risk_pipeline.joblib`
- **sha256:** `7f4c60f2ab5e67344ac87b9d2bb0570ddc82bdd858d18e7237689f9a3b9ec69b`
- **estimator:** `lightgbm.sklearn.LGBMClassifier`
- **steps:** `[{'name': 'estimator', 'class': 'lightgbm.sklearn.LGBMClassifier'}]`
- **endpoint:** `POST /v1/risk/predict`
