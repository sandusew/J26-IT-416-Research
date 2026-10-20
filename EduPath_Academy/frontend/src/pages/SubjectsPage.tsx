import { Link } from 'react-router-dom'
import { BookOpen, ChevronRight } from 'lucide-react'
import { PageHeader } from '../components/ui'
import curriculum from '../data/curriculum.en.json'

type CurriculumFile = {
  curriculumVersion: string
  subjects: Array<{ subjectId: string; subjectName: string; topics: unknown[] }>
}

const data = curriculum as CurriculumFile

export default function SubjectsPage() {
  return (
    <div>
      <PageHeader
        title="My Course"
        subtitle={`Subject analysis starts here. Provisional curriculum ${data.curriculumVersion}.`}
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {data.subjects.map((s) => (
          <li key={s.subjectId}>
            <Link
              to={`/subjects/${s.subjectId}`}
              className="card flex items-center justify-between gap-3 rounded-3xl transition hover:border-[#4c3ad6]/30 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-[#4c3ad6]" aria-hidden />
                <div>
                  <p className="font-medium text-navy-950">{s.subjectName}</p>
                  <p className="text-xs text-navy-800/60">{s.topics.length} topics</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-navy-800/40" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
